import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { Hono, type Context } from "hono";
import cron from "node-cron";
import { isAddress } from "ethers";
import type {
  BorrowIntent,
  LendIntent,
  MatchRequest,
  MatchResponse,
  SignedProposal,
} from "./types";

type StoredSignedProposal = SignedProposal & {
  status: "pending" | "expired" | "settled" | "failed";
  createdAt: number;
  expiresAt: number;
};

const lendIntents: LendIntent[] = [];
const borrowIntents: BorrowIntent[] = [];
const proposals: StoredSignedProposal[] = [];
let epochCounter = 0;

export const app = new Hono();
app.use("*", cors());
app.onError((error, c) => {
  const debug = createRequestDebug(c, "unhandled");
  console.error(`[api:${debug.requestId}] unhandled ${c.req.method} ${debug.path}:`, formatErrorForLog(error));
  return c.json(
    {
      error: "Internal server error",
      requestId: debug.requestId,
      details: error instanceof Error ? error.message : String(error),
    },
    500,
  );
});

app.get("/", (c) => c.json({ ok: true, service: "privalend-server" }));

app.post("/api/v1/lend-intent", async (c) => {
  const debug = createRequestDebug(c, "lend");

  try {
    const body = await readJsonObject(c, debug);
    const intent: LendIntent = {
      intentId: normalizeIntentId(body.intentId) ?? crypto.randomUUID(),
      userId: normalizeAddress(body.userId, "userId"),
      token: normalizeAddress(body.token, "token"),
      amount: normalizeBaseUnits(body.amount, "amount"),
      encryptedRate: normalizeEncryptedRate(body.encryptedRate, "encryptedRate"),
      epochId: ++epochCounter,
      createdAt: Date.now(),
    };

    lendIntents.push(intent);
    console.log(
      `[api:${debug.requestId}] lend accepted intent=${intent.intentId} lender=${intent.userId} token=${intent.token} amount=${intent.amount} rate=${summarizeRatePayload(intent.encryptedRate)}`,
    );
    return c.json({ intent, debug: responseDebug(debug) });
  } catch (error) {
    return rejectRequest(c, debug, error);
  }
});

app.post("/api/v1/borrow-intent", async (c) => {
  const debug = createRequestDebug(c, "borrow");

  try {
    const body = await readJsonObject(c, debug);
    const intent: BorrowIntent = {
      intentId: normalizeIntentId(body.intentId) ?? crypto.randomUUID(),
      borrower: normalizeAddress(body.borrower, "borrower"),
      token: normalizeAddress(body.token, "token"),
      amount: normalizeBaseUnits(body.amount, "amount"),
      encryptedMaxRate: normalizeEncryptedRate(body.encryptedMaxRate, "encryptedMaxRate"),
      collateralToken: normalizeAddress(body.collateralToken, "collateralToken"),
      collateralAmount: normalizeBaseUnits(body.collateralAmount, "collateralAmount"),
      status: "pending",
      createdAt: Date.now(),
    };

    borrowIntents.push(intent);
    console.log(
      `[api:${debug.requestId}] borrow accepted intent=${intent.intentId} borrower=${intent.borrower} token=${intent.token} amount=${intent.amount} maxRate=${summarizeRatePayload(intent.encryptedMaxRate)} collateral=${intent.collateralAmount}:${intent.collateralToken}`,
    );
    return c.json({ intent, debug: responseDebug(debug) });
  } catch (error) {
    return rejectRequest(c, debug, error);
  }
});

app.post("/api/v1/cancel-intent/:id", (c) => {
  const id = c.req.param("id");
  let removed = false;

  const lendIndex = lendIntents.findIndex((intent) => intent.intentId === id);
  if (lendIndex >= 0) {
    lendIntents.splice(lendIndex, 1);
    removed = true;
  }

  const borrow = borrowIntents.find((intent) => intent.intentId === id);
  if (borrow) {
    borrow.status = "cancelled";
    removed = true;
  }

  return c.json({ ok: removed });
});

app.get("/api/v1/proposals", (c) => c.json({ proposals }));

app.get("/api/v1/proposals/:id", (c) => {
  const proposal = proposals.find((p) => p.proposalId === c.req.param("id"));
  return proposal ? c.json(proposal) : c.json({ error: "not found" }, 404);
});

app.post("/api/v1/proposals/:id/status", async (c) => {
  if (!isAdminAuthorized(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const proposal = proposals.find((p) => p.proposalId === c.req.param("id"));
  if (!proposal) return c.json({ error: "not found" }, 404);

  const body = await c.req.json<Record<string, unknown>>();
  const status = normalizeNonEmptyString(body.status, "status");
  if (!["pending", "expired", "settled", "failed"].includes(status)) {
    return c.json({ error: "invalid status" }, 400);
  }

  proposal.status = status as StoredSignedProposal["status"];
  const borrow = borrowIntents.find((intent) => intent.intentId === proposal.borrowIntentId);
  if (borrow && status === "settled") borrow.status = "matched";
  return c.json({ proposal });
});

app.post("/admin/tick", async (c) => {
  if (!isAdminAuthorized(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const result = await runEpoch();
  return c.json({ ok: true, ...result });
});

export async function runEpoch(): Promise<{ matched: number; skipped?: string }> {
  const lockedLendIds = new Set(
    proposals
      .filter((proposal) => proposal.status === "pending" || proposal.status === "settled")
      .flatMap((proposal) => proposal.matchedTicks.map((tick) => tick.lendIntentId)),
  );

  const payload: MatchRequest = {
    lendIntents: lendIntents.filter((intent) => !lockedLendIds.has(intent.intentId)),
    borrowIntents: borrowIntents.filter((intent) => intent.status === "pending"),
  };

  if (payload.lendIntents.length === 0 || payload.borrowIntents.length === 0) {
    console.log("[tick] nothing to match");
    return { matched: 0, skipped: "nothing to match" };
  }

  const workflowUrl = process.env.CRE_WORKFLOW_URL;
  if (!workflowUrl) {
    console.error("[tick] CRE_WORKFLOW_URL not set; skipping");
    return { matched: 0, skipped: "CRE_WORKFLOW_URL not set" };
  }

  console.log(
    `[tick] ${payload.lendIntents.length} lend / ${payload.borrowIntents.length} borrow`,
  );

  const resp = await fetch(workflowUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await resp.text();
  if (!resp.ok) {
    console.error(`[tick] CRE workflow failed: ${resp.status} ${text}`);
    return { matched: 0, skipped: `CRE workflow failed: ${resp.status}` };
  }

  const data = JSON.parse(text) as MatchResponse;
  if (data.error) {
    console.error(`[tick] CRE workflow error: ${data.error}`);
    return { matched: 0, skipped: data.error };
  }

  const now = Date.now();
  for (const proposal of data.proposals) {
    proposals.push({
      ...proposal,
      status: "pending",
      createdAt: now,
      expiresAt: now + 5 * 60 * 1000,
    });

    const borrow = borrowIntents.find((intent) => intent.intentId === proposal.borrowIntentId);
    if (borrow) borrow.status = "proposed";
  }

  console.log(`[tick] matched ${data.proposals.length} proposals`);
  return { matched: data.proposals.length };
}

function expirePendingProposals(): void {
  const now = Date.now();
  for (const proposal of proposals) {
    if (proposal.status === "pending" && proposal.expiresAt < now) {
      proposal.status = "expired";
    }
  }
}

cron.schedule("*/30 * * * * *", () => {
  runEpoch().catch((e) => console.error("[tick] error:", e));
});

cron.schedule("*/10 * * * * *", expirePendingProposals);

const port = Number(process.env.PORT || 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`PrivaLend server listening on :${info.port}`);
});

type RequestDebug = {
  bodySummary?: Record<string, string>;
  contentType: string;
  origin: string;
  path: string;
  requestId: string;
  route: "lend" | "borrow" | "unhandled";
  startedAt: number;
  userAgent: string;
};

class ApiInputError extends Error {
  details?: string;
  field?: string;
  status: 400 | 422;

  constructor(message: string, options: { details?: string; field?: string; status?: 400 | 422 } = {}) {
    super(message);
    this.name = "ApiInputError";
    this.details = options.details;
    this.field = options.field;
    this.status = options.status ?? 400;
  }
}

function createRequestDebug(c: Context, route: RequestDebug["route"]): RequestDebug {
  return {
    contentType: c.req.header("content-type") ?? "<missing>",
    origin: c.req.header("origin") ?? "<none>",
    path: new URL(c.req.url).pathname,
    requestId: c.req.header("x-request-id") ?? crypto.randomUUID(),
    route,
    startedAt: Date.now(),
    userAgent: c.req.header("user-agent") ?? "<none>",
  };
}

async function readJsonObject(c: Context, debug: RequestDebug): Promise<Record<string, unknown>> {
  if (!debug.contentType.toLowerCase().includes("application/json")) {
    console.warn(
      `[api:${debug.requestId}] ${debug.route} unexpected content-type=${debug.contentType} origin=${debug.origin}`,
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch (error) {
    console.error(`[api:${debug.requestId}] ${debug.route} invalid JSON:`, formatErrorForLog(error));
    throw new ApiInputError("Invalid JSON request body", {
      details: error instanceof Error ? error.message : String(error),
    });
  }

  if (!isRecord(body)) {
    throw new ApiInputError("Request body must be a JSON object");
  }

  debug.bodySummary = summarizeBody(body);
  console.log(
    `[api:${debug.requestId}] ${debug.route} received path=${debug.path} origin=${debug.origin} content-type=${debug.contentType} userAgent=${summarizeValue(debug.userAgent)} body=${JSON.stringify(debug.bodySummary)}`,
  );
  return body;
}

function rejectRequest(c: Context, debug: RequestDebug, error: unknown): Response {
  const inputError = error instanceof ApiInputError ? error : undefined;
  const status = inputError?.status ?? 500;
  const message = inputError?.message ?? "Unexpected API error";
  const elapsedMs = Date.now() - debug.startedAt;
  const payload = {
    error: message,
    requestId: debug.requestId,
    route: debug.route,
    field: inputError?.field,
    details: inputError?.details ?? (error instanceof Error ? error.message : String(error)),
  };

  console.error(
    `[api:${debug.requestId}] ${debug.route} rejected status=${status} elapsedMs=${elapsedMs} error=${message} field=${payload.field ?? "<none>"} details=${payload.details ?? "<none>"} body=${JSON.stringify(debug.bodySummary ?? {})}`,
  );

  return c.json(payload, status);
}

function responseDebug(debug: RequestDebug) {
  return {
    requestId: debug.requestId,
    route: debug.route,
    elapsedMs: Date.now() - debug.startedAt,
  };
}

function normalizeAddress(value: unknown, field: string): string {
  const text = normalizeNonEmptyString(value, field);
  if (!isAddress(text)) {
    throw new ApiInputError(`${field} must be a valid Ethereum address`, {
      details: `Received ${summarizeValue(text)}`,
      field,
      status: 422,
    });
  }
  return text.toLowerCase();
}

function normalizeBaseUnits(value: unknown, field: string): string {
  const text = normalizeNonEmptyString(value, field);
  if (!/^\d+$/.test(text)) {
    throw new ApiInputError(`${field} must be a base-unit integer string`, {
      details: `Received ${summarizeValue(text)}`,
      field,
      status: 422,
    });
  }

  const amount = BigInt(text);
  if (amount <= 0n) {
    throw new ApiInputError(`${field} must be greater than zero`, {
      details: `Received ${text}`,
      field,
      status: 422,
    });
  }

  return text;
}

function normalizeEncryptedRate(value: unknown, field: string): string {
  const text = normalizeNonEmptyString(value, field);
  if (text.startsWith("0x")) {
    if (!/^0x[0-9a-fA-F]+$/.test(text) || text.length % 2 !== 0) {
      throw new ApiInputError(`${field} must be 0x-prefixed hex ciphertext`, {
        details: `Received ${summarizeRatePayload(text)}`,
        field,
        status: 422,
      });
    }
    return text;
  }

  const plaintextRate = Number(text);
  if (!Number.isFinite(plaintextRate) || plaintextRate <= 0 || plaintextRate >= 1) {
    throw new ApiInputError(`${field} must be ciphertext hex or a local-dev decimal rate in (0, 1)`, {
      details: `Received ${summarizeRatePayload(text)}`,
      field,
      status: 422,
    });
  }

  return text;
}

function normalizeIntentId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const text = String(value).trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(text)) {
    throw new ApiInputError("intentId must be a bytes32 hex string when provided", {
      details: `Received ${summarizeValue(text)}`,
      field: "intentId",
      status: 422,
    });
  }
  return text.toLowerCase();
}

function isAdminAuthorized(c: Context): boolean {
  const expected = process.env.ADMIN_KEY?.trim();
  return !expected || c.req.header("x-admin-key")?.trim() === expected;
}

function normalizeNonEmptyString(value: unknown, field: string): string {
  if (value === undefined || value === null) {
    throw new ApiInputError(`Missing required field: ${field}`, { field });
  }

  const text = String(value).trim();
  if (!text) {
    throw new ApiInputError(`Field cannot be empty: ${field}`, { field });
  }

  return text;
}

function summarizeBody(body: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => [
      key,
      key.toLowerCase().includes("encrypted") ? summarizeRatePayload(value) : summarizeValue(value),
    ]),
  );
}

function summarizeRatePayload(value: unknown): string {
  const text = String(value ?? "");
  if (!text) return "<empty>";
  if (text.startsWith("0x")) return `hex:${text.length}chars`;
  return `plaintext-decimal:${text.length}chars`;
}

function summarizeValue(value: unknown): string {
  if (value === undefined) return "<undefined>";
  if (value === null) return "<null>";
  const text = String(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatErrorForLog(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
}
