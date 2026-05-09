import { decryptRateWithOptions } from "./ecies";
import type {
  BorrowIntent,
  DecryptedBorrow,
  DecryptedLend,
  LendIntent,
  MatchedTick,
  Proposal,
} from "./types";

/**
 * The PrivaLend matching engine. This is deliberately pure: no I/O, no clock,
 * no randomness. Given identical inputs, it returns identical proposals.
 */
export function runMatchingEngine(
  lendIntents: LendIntent[],
  borrowIntents: BorrowIntent[],
  privateKeyHex?: string,
  options: { allowPlaintextRateFallback?: boolean } = {},
): Proposal[] {
  const allowPlaintextRateFallback = options.allowPlaintextRateFallback ?? true;
  const lends: DecryptedLend[] = lendIntents.map((l) => ({
    intentId: l.intentId,
    userId: l.userId.toLowerCase(),
    token: l.token.toLowerCase(),
    amount: Number(l.amount),
    rate: decryptRateWithOptions(
      l.encryptedRate,
      privateKeyHex,
      allowPlaintextRateFallback,
    ),
  }));

  const borrows: DecryptedBorrow[] = borrowIntents.map((b) => ({
    intentId: b.intentId,
    borrower: b.borrower.toLowerCase(),
    token: b.token.toLowerCase(),
    amount: Number(b.amount),
    maxRate: decryptRateWithOptions(
      b.encryptedMaxRate,
      privateKeyHex,
      allowPlaintextRateFallback,
    ),
    collateralToken: b.collateralToken.toLowerCase(),
    collateralAmount: b.collateralAmount,
  }));

  borrows.sort((a, b) => b.amount - a.amount);
  lends.sort((a, b) => a.rate - b.rate);

  const remaining = new Map<string, number>();
  for (const lend of lends) {
    remaining.set(lend.intentId, lend.amount);
  }

  const proposals: Proposal[] = [];

  for (const borrow of borrows) {
    let filled = 0;
    let weightedRateSum = 0;
    const ticks: MatchedTick[] = [];

    for (const lend of lends) {
      if (filled >= borrow.amount) break;
      if (lend.token !== borrow.token) continue;

      const available = remaining.get(lend.intentId) ?? 0;
      if (available <= 0) continue;

      const take = Math.min(available, borrow.amount - filled);
      ticks.push({
        lender: lend.userId,
        lendIntentId: lend.intentId,
        amount: String(take),
        rate: lend.rate,
      });

      weightedRateSum += take * lend.rate;
      filled += take;
      remaining.set(lend.intentId, available - take);
    }

    if (filled <= 0) continue;

    const blendedRate = weightedRateSum / filled;
    if (blendedRate > borrow.maxRate) {
      for (const tick of ticks) {
        const previous = remaining.get(tick.lendIntentId) ?? 0;
        remaining.set(tick.lendIntentId, previous + Number(tick.amount));
      }
      continue;
    }

    proposals.push({
      proposalId: deterministicProposalId(borrow.intentId, proposals.length),
      borrowIntentId: borrow.intentId,
      borrower: borrow.borrower,
      token: borrow.token,
      principal: String(filled),
      matchedTicks: ticks,
      effectiveBorrowerRate: blendedRate,
      collateralToken: borrow.collateralToken,
      collateralAmount: borrow.collateralAmount,
    });
  }

  return proposals;
}

function deterministicProposalId(borrowIntentId: string, outputIndex: number): string {
  return `p-${outputIndex + 1}-${borrowIntentId}`;
}

export type {
  BorrowIntent,
  LendIntent,
  MatchedTick,
  Proposal,
  SignedProposal,
} from "./types";
