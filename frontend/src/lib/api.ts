import type { Address, Hex } from "viem";
import { publicEnv } from "./env";

export type BackendIntentSide = "lend" | "borrow";

export type BackendLendIntent = {
  intentId: string;
  userId: string;
  token: string;
  amount: string;
  encryptedRate: string;
  epochId: number;
  createdAt: number;
};

export type BackendBorrowIntent = {
  intentId: string;
  borrower: string;
  token: string;
  amount: string;
  encryptedMaxRate: string;
  collateralToken: string;
  collateralAmount: string;
  status: "pending" | "proposed" | "matched" | "cancelled" | "rejected";
  createdAt: number;
};

export type MatchedTick = {
  lender: Address;
  lendIntentId: string;
  amount: string;
  rate: number;
};

export type SignedProposal = {
  proposalId: string;
  borrowIntentId: string;
  borrower: Address;
  token: Address;
  principal: string;
  matchedTicks: MatchedTick[];
  effectiveBorrowerRate: number;
  collateralToken: Address;
  collateralAmount: string;
  proposalHash: Hex;
  kmsSignature: Hex;
  kmsAddress?: Address;
  kmsKeyId?: string;
  status?: "pending" | "expired" | "settled" | "failed";
  createdAt?: number;
  expiresAt?: number;
};

export type PostedIntent = {
  side: BackendIntentSide;
  intentId: string;
  address: Address;
  amount: string;
  rate: number;
  createdAt: number;
};

export class ApiRequestError extends Error {
  method: string;
  path: string;
  requestId?: string;
  responseBody?: unknown;
  status?: number;

  constructor(
    message: string,
    options: {
      method: string;
      path: string;
      requestId?: string;
      responseBody?: unknown;
      status?: number;
    },
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.method = options.method;
    this.path = options.path;
    this.requestId = options.requestId;
    this.responseBody = options.responseBody;
    this.status = options.status;
  }
}

export async function postLendIntent(input: {
  lenderAddress: Address;
  tokenAddress: Address;
  amount: bigint;
  encryptedRate: string;
}) {
  return postJson<{ intent: BackendLendIntent }>("/api/v1/lend-intent", {
    userId: input.lenderAddress.toLowerCase(),
    token: input.tokenAddress.toLowerCase(),
    amount: input.amount.toString(),
    encryptedRate: input.encryptedRate,
  });
}

export async function postBorrowIntent(input: {
  borrowerAddress: Address;
  tokenAddress: Address;
  amount: bigint;
  encryptedMaxRate: string;
  collateralTokenAddress: Address;
  collateralAmount: bigint;
}) {
  return postJson<{ intent: BackendBorrowIntent }>("/api/v1/borrow-intent", {
    borrower: input.borrowerAddress.toLowerCase(),
    token: input.tokenAddress.toLowerCase(),
    amount: input.amount.toString(),
    encryptedMaxRate: input.encryptedMaxRate,
    collateralToken: input.collateralTokenAddress.toLowerCase(),
    collateralAmount: input.collateralAmount.toString(),
  });
}

export async function getProposals() {
  return getJson<{ proposals: SignedProposal[] }>("/api/v1/proposals");
}

export async function postDemoTick() {
  return postJson<Record<string, unknown>>("/api/demo/tick", {}, "");
}

async function getJson<T>(path: string): Promise<T> {
  const method = "GET";
  let response: Response;
  try {
    response = await fetch(`${publicEnv.backendUrl}${path}`, {
      headers: { accept: "application/json" },
    });
  } catch (error) {
    throw new ApiRequestError(`API ${method} ${path} could not reach ${publicEnv.backendUrl}: ${unknownErrorMessage(error)}`, {
      method,
      path,
    });
  }
  return parseResponse<T>(response, { method, path });
}

async function postJson<T>(path: string, body: unknown, baseUrl = publicEnv.backendUrl): Promise<T> {
  const method = "POST";
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new ApiRequestError(`API ${method} ${path} could not reach ${baseUrl}: ${unknownErrorMessage(error)}`, {
      method,
      path,
    });
  }
  return parseResponse<T>(response, { method, path });
}

async function parseResponse<T>(response: Response, request: { method: string; path: string }): Promise<T> {
  const text = await response.text();
  const data = parseJsonResponse(text, request);

  if (!response.ok) {
    const details = isRecord(data) ? data : {};
    const message = formatApiErrorMessage(response.status, request, details, text);
    throw new ApiRequestError(message, {
      method: request.method,
      path: request.path,
      requestId: typeof details.requestId === "string" ? details.requestId : undefined,
      responseBody: data,
      status: response.status,
    });
  }

  return data as T;
}

function parseJsonResponse(text: string, request: { method: string; path: string }): unknown {
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ApiRequestError(`API ${request.method} ${request.path} returned invalid JSON: ${unknownErrorMessage(error)}`, {
      method: request.method,
      path: request.path,
      responseBody: text.slice(0, 500),
    });
  }
}

function formatApiErrorMessage(
  status: number,
  request: { method: string; path: string },
  data: Record<string, unknown>,
  rawText: string,
) {
  const error = typeof data.error === "string" ? data.error : `Request failed with ${status}`;
  const parts = [`API ${request.method} ${request.path} failed (${status}): ${error}`];

  if (typeof data.field === "string") parts.push(`field=${data.field}`);
  if (typeof data.details === "string" && data.details && data.details !== error) {
    parts.push(`details=${data.details}`);
  } else if (Object.keys(data).length === 0 && rawText) {
    parts.push(`body=${rawText.slice(0, 200)}`);
  }
  if (typeof data.requestId === "string") parts.push(`requestId=${data.requestId}`);

  return parts.join(" | ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}
