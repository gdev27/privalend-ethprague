import { describe, expect, test } from "vitest";
import { encrypt, PrivateKey } from "eciesjs";
import { Buffer } from "node:buffer";
import { runMatchingEngine } from "./engine";
import type { BorrowIntent, LendIntent } from "./types";

const USDC = "0x0000000000000000000000000000000000000001";
const DAI = "0x0000000000000000000000000000000000000002";
const WETH = "0x000000000000000000000000000000000000beef";

const LENDER_A = "0x000000000000000000000000000000000000aaaa";
const LENDER_B = "0x000000000000000000000000000000000000bbbb";
const LENDER_C = "0x000000000000000000000000000000000000cccc";

const BORROWER_X = "0x0000000000000000000000000000000000001111";
const BORROWER_Y = "0x0000000000000000000000000000000000002222";

let intentCounter = 0;
const nextId = (): string => `intent-${++intentCounter}`;

function makeLend(
  userId: string,
  token: string,
  amount: number,
  rate: number,
): LendIntent {
  return {
    intentId: nextId(),
    userId,
    token,
    amount: String(amount),
    encryptedRate: String(rate),
    epochId: 1,
    createdAt: 0,
  };
}

function makeBorrow(
  borrower: string,
  token: string,
  amount: number,
  maxRate: number,
  collateralToken: string = WETH,
  collateralAmount: number = amount,
): BorrowIntent {
  return {
    intentId: nextId(),
    borrower,
    token,
    amount: String(amount),
    encryptedMaxRate: String(maxRate),
    collateralToken,
    collateralAmount: String(collateralAmount),
    status: "pending",
    createdAt: 0,
  };
}

describe("PrivaLend matching engine", () => {
  test("1. Happy path: two lenders, one borrower, blended rate within bounds", () => {
    const lends = [
      makeLend(LENDER_A, USDC, 100, 0.04),
      makeLend(LENDER_B, USDC, 100, 0.06),
    ];
    const borrows = [makeBorrow(BORROWER_X, USDC, 200, 0.07)];

    const proposals = runMatchingEngine(lends, borrows);

    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    expect(p.borrowIntentId).toBe(borrows[0].intentId);
    expect(p.principal).toBe("200");
    expect(p.matchedTicks).toHaveLength(2);

    const tickA = p.matchedTicks.find((t) => t.lender === LENDER_A);
    const tickB = p.matchedTicks.find((t) => t.lender === LENDER_B);
    expect(tickA?.rate).toBeCloseTo(0.04);
    expect(tickB?.rate).toBeCloseTo(0.06);

    expect(p.effectiveBorrowerRate).toBeCloseTo(0.05);
    expect(p.effectiveBorrowerRate).toBeLessThanOrEqual(0.07);
  });

  test("2. Cheapest-first: cheapest lender ticks are filled before more expensive ones", () => {
    const lends = [
      makeLend(LENDER_A, USDC, 50, 0.08),
      makeLend(LENDER_B, USDC, 50, 0.05),
      makeLend(LENDER_C, USDC, 50, 0.06),
    ];
    const borrows = [makeBorrow(BORROWER_X, USDC, 100, 0.1)];

    const proposals = runMatchingEngine(lends, borrows);

    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    expect(p.principal).toBe("100");
    expect(p.matchedTicks).toHaveLength(2);

    const lenders = p.matchedTicks.map((t) => t.lender).sort();
    expect(lenders).toEqual([LENDER_B, LENDER_C].sort());

    const lenderATick = p.matchedTicks.find((t) => t.lender === LENDER_A);
    expect(lenderATick).toBeUndefined();
  });

  test("3. Rate ceiling: proposal rejected when blended rate exceeds borrower's max", () => {
    const lends = [makeLend(LENDER_A, USDC, 100, 0.09)];
    const borrows = [makeBorrow(BORROWER_X, USDC, 100, 0.08)];

    const proposals = runMatchingEngine(lends, borrows);

    expect(proposals).toHaveLength(0);
  });

  test("3b. Rate ceiling: when proposal is rejected, lend ticks roll back for next epoch", () => {
    const lends = [makeLend(LENDER_A, USDC, 100, 0.09)];
    const borrows = [
      makeBorrow(BORROWER_X, USDC, 100, 0.08),
      makeBorrow(BORROWER_Y, USDC, 100, 0.1),
    ];

    const proposals = runMatchingEngine(lends, borrows);

    expect(proposals).toHaveLength(1);
    expect(proposals[0].borrowIntentId).toBe(borrows[1].intentId);
    expect(proposals[0].principal).toBe("100");
  });

  test("4. Partial fill: one borrower can be filled by multiple lender ticks of different sizes", () => {
    const lends = [
      makeLend(LENDER_A, USDC, 100, 0.05),
      makeLend(LENDER_B, USDC, 100, 0.05),
    ];
    const borrows = [makeBorrow(BORROWER_X, USDC, 150, 0.1)];

    const proposals = runMatchingEngine(lends, borrows);

    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    expect(p.principal).toBe("150");
    expect(p.matchedTicks).toHaveLength(2);

    const amounts = p.matchedTicks
      .map((t) => Number(t.amount))
      .sort((a, b) => b - a);
    expect(amounts).toEqual([100, 50]);
  });

  test("5. Token isolation: a USDC borrower cannot be filled by a DAI lender", () => {
    const lends = [makeLend(LENDER_A, DAI, 100, 0.03)];
    const borrows = [makeBorrow(BORROWER_X, USDC, 100, 0.1)];

    const proposals = runMatchingEngine(lends, borrows);

    expect(proposals).toHaveLength(0);
  });

  test("6. Largest borrower first: borrowers are processed in descending size order", () => {
    const lends = [makeLend(LENDER_A, USDC, 200, 0.05)];
    const borrows = [
      makeBorrow(BORROWER_X, USDC, 50, 0.1),
      makeBorrow(BORROWER_Y, USDC, 150, 0.1),
    ];

    const proposals = runMatchingEngine(lends, borrows);

    expect(proposals).toHaveLength(2);
    expect(proposals[0].borrowIntentId).toBe(borrows[1].intentId);
    expect(proposals[1].borrowIntentId).toBe(borrows[0].intentId);
  });

  test("6b. Largest borrower first: when liquidity is tight, the smaller borrower may go unfilled", () => {
    const lends = [makeLend(LENDER_A, USDC, 100, 0.05)];
    const borrows = [
      makeBorrow(BORROWER_X, USDC, 50, 0.1),
      makeBorrow(BORROWER_Y, USDC, 150, 0.1),
    ];

    const proposals = runMatchingEngine(lends, borrows);

    expect(proposals).toHaveLength(1);
    expect(proposals[0].borrowIntentId).toBe(borrows[1].intentId);
    expect(proposals[0].principal).toBe("100");
  });

  test("7. Plaintext fallback: a numeric string in [0, 1) is accepted without a private key", () => {
    const lends = [makeLend(LENDER_A, USDC, 100, 0.05)];
    const borrows = [makeBorrow(BORROWER_X, USDC, 100, 0.1)];

    const proposals = runMatchingEngine(lends, borrows, undefined);

    expect(proposals).toHaveLength(1);
    expect(proposals[0].matchedTicks[0].rate).toBeCloseTo(0.05);
  });

  test("8. Real ECIES decrypt: a real ciphertext decrypts to the original rate inside the engine", () => {
    const sk = new PrivateKey();
    const privateKeyHex = Buffer.from(sk.secret).toString("hex");
    const publicKeyBytes = sk.publicKey.toBytes();

    const encryptRate = (rate: string): string => {
      const ct = encrypt(publicKeyBytes, Buffer.from(rate));
      return "0x" + Buffer.from(ct).toString("hex");
    };

    const lends: LendIntent[] = [
      {
        intentId: "lend-real-1",
        userId: LENDER_A,
        token: USDC,
        amount: "100",
        encryptedRate: encryptRate("0.07"),
        epochId: 1,
        createdAt: 0,
      },
    ];
    const borrows: BorrowIntent[] = [
      {
        intentId: "borrow-real-1",
        borrower: BORROWER_X,
        token: USDC,
        amount: "100",
        encryptedMaxRate: encryptRate("0.10"),
        collateralToken: WETH,
        collateralAmount: "100",
        status: "pending",
        createdAt: 0,
      },
    ];

    const proposals = runMatchingEngine(lends, borrows, privateKeyHex);

    expect(proposals).toHaveLength(1);
    expect(proposals[0].matchedTicks).toHaveLength(1);
    expect(proposals[0].matchedTicks[0].rate).toBeCloseTo(0.07);
    expect(proposals[0].effectiveBorrowerRate).toBeCloseTo(0.07);
  });
});
