import { keccak256, toBytes, type Address, type Hex } from "viem";
import { rateToWad } from "./amounts";
import type { SignedProposal } from "./api";

export function stringIdToBytes32(value: string): Hex {
  return keccak256(toBytes(value));
}

export function proposalToSettleArgs(proposal: SignedProposal) {
  return [
    {
      proposalId: stringIdToBytes32(proposal.proposalId),
      borrowIntentId: stringIdToBytes32(proposal.borrowIntentId),
      borrower: proposal.borrower,
      token: proposal.token,
      principal: BigInt(proposal.principal),
      effectiveBorrowerRate: rateToWad(proposal.effectiveBorrowerRate),
      collateralToken: proposal.collateralToken,
      collateralAmount: BigInt(proposal.collateralAmount),
    },
    proposal.matchedTicks.map((tick) => ({
      lender: tick.lender,
      lendIntentId: stringIdToBytes32(tick.lendIntentId),
      amount: BigInt(tick.amount),
      rate: rateToWad(tick.rate),
    })),
    proposal.proposalHash,
    proposal.kmsSignature,
  ] as const;
}

export function proposalInvolvesAddress(proposal: SignedProposal, address: Address) {
  const normalized = address.toLowerCase();
  return (
    proposal.borrower.toLowerCase() === normalized ||
    proposal.matchedTicks.some((tick) => tick.lender.toLowerCase() === normalized)
  );
}

export function proposalRole(proposal: SignedProposal, address: Address): "borrower" | "lender" | "both" {
  const normalized = address.toLowerCase();
  const borrower = proposal.borrower.toLowerCase() === normalized;
  const lender = proposal.matchedTicks.some((tick) => tick.lender.toLowerCase() === normalized);
  if (borrower && lender) return "both";
  return borrower ? "borrower" : "lender";
}
