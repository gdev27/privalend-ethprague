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
  const response = await fetch(`${publicEnv.backendUrl}${path}`, {
    headers: { accept: "application/json" },
  });
  return parseResponse<T>(response);
}

async function postJson<T>(path: string, body: unknown, baseUrl = publicEnv.backendUrl): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseResponse<T>(response);
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const message = typeof data?.error === "string" ? data.error : `Request failed with ${response.status}`;
    throw new Error(message);
  }

  return data as T;
}
