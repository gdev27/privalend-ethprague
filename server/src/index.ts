import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { Hono } from "hono";
import cron from "node-cron";
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

app.get("/", (c) => c.json({ ok: true, service: "privalend-server" }));

app.post("/api/v1/lend-intent", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const intent: LendIntent = {
    intentId: crypto.randomUUID(),
    userId: normalizeString(body.userId, "userId").toLowerCase(),
    token: normalizeString(body.token, "token").toLowerCase(),
    amount: normalizeString(body.amount, "amount"),
    encryptedRate: normalizeString(body.encryptedRate, "encryptedRate"),
    epochId: ++epochCounter,
    createdAt: Date.now(),
  };

  lendIntents.push(intent);
  console.log("[lend]", intent.intentId, intent.amount, intent.token);
  return c.json({ intent });
});

app.post("/api/v1/borrow-intent", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const intent: BorrowIntent = {
    intentId: crypto.randomUUID(),
    borrower: normalizeString(body.borrower, "borrower").toLowerCase(),
    token: normalizeString(body.token, "token").toLowerCase(),
    amount: normalizeString(body.amount, "amount"),
    encryptedMaxRate: normalizeString(body.encryptedMaxRate, "encryptedMaxRate"),
    collateralToken: normalizeString(body.collateralToken, "collateralToken").toLowerCase(),
    collateralAmount: normalizeString(body.collateralAmount, "collateralAmount"),
    status: "pending",
    createdAt: Date.now(),
  };

  borrowIntents.push(intent);
  console.log("[borrow]", intent.intentId, intent.amount, intent.token);
  return c.json({ intent });
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

app.post("/admin/tick", async (c) => {
  if (c.req.header("x-admin-key") !== process.env.ADMIN_KEY) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const result = await runEpoch();
  return c.json({ ok: true, ...result });
});

export async function runEpoch(): Promise<{ matched: number; skipped?: string }> {
  const lockedLendIds = new Set(
    proposals
      .filter((proposal) => proposal.status === "pending")
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

function normalizeString(value: unknown, field: string): string {
  if (value === undefined || value === null) {
    throw new Error(`missing ${field}`);
  }
  return String(value);
}

cron.schedule("*/30 * * * * *", () => {
  runEpoch().catch((e) => console.error("[tick] error:", e));
});

cron.schedule("*/10 * * * * *", expirePendingProposals);

const port = Number(process.env.PORT || 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`PrivaLend server listening on :${info.port}`);
});
