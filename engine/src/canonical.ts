import { keccak_256 } from "@noble/hashes/sha3";
import { Buffer } from "node:buffer";
import type { Proposal } from "./types";

/**
 * Canonical encoding of a proposal for hashing.
 *
 * The on-chain pool must use the same field order and rate formatting before
 * verifying the EIP-191 signature.
 */
export function canonicalEncode(p: Proposal): string {
  const stable = {
    proposalId: p.proposalId,
    borrowIntentId: p.borrowIntentId,
    borrower: p.borrower,
    token: p.token,
    principal: p.principal,
    matchedTicks: p.matchedTicks.map((t) => ({
      lender: t.lender,
      lendIntentId: t.lendIntentId,
      amount: t.amount,
      rate: t.rate.toFixed(18),
    })),
    effectiveBorrowerRate: p.effectiveBorrowerRate.toFixed(18),
    collateralToken: p.collateralToken,
    collateralAmount: p.collateralAmount,
  };
  return JSON.stringify(stable);
}

export function proposalHash(p: Proposal): string {
  const hash = keccak_256(Buffer.from(canonicalEncode(p)));
  return "0x" + Buffer.from(hash).toString("hex");
}
