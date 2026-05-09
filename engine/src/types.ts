// Canonical types for the PrivaLend matching engine.
// See TYPES.md in the project root for documentation on conventions.

// ---------------------------------------------------------------------------
// User-submitted intents (encrypted on the client, decrypted only inside TEE)
// ---------------------------------------------------------------------------

export interface LendIntent {
  /** Server-generated UUID, unique. */
  intentId: string;

  /** 0x-prefixed lender address, lowercase. */
  userId: string;

  /** 0x-prefixed loan asset address, lowercase. */
  token: string;

  /** Base-units (wei-equivalent), bigint as string. */
  amount: string;

  /**
   * ECIES ciphertext of the rate, 0x-prefixed hex.
   * Plaintext = decimal string in `[0, 1)`, e.g. "0.05" = 5% APY.
   */
  encryptedRate: string;

  /** Monotonically increasing, set by Railway at submission. */
  epochId: number;

  /** Unix ms. */
  createdAt: number;
}

export interface BorrowIntent {
  intentId: string;

  /** 0x-prefixed borrower address, lowercase. */
  borrower: string;

  /** Loan asset address. */
  token: string;

  /** Base-units. */
  amount: string;

  /** ECIES ciphertext of the borrower's max acceptable rate, same format as encryptedRate. */
  encryptedMaxRate: string;

  /** Collateral asset address, lowercase. */
  collateralToken: string;

  /** Base-units. */
  collateralAmount: string;

  status: "pending" | "proposed" | "matched" | "cancelled" | "rejected";
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Engine-internal: decrypted intents during matching
// ---------------------------------------------------------------------------
// These shapes only exist in TEE memory during one matching round. Never
// exposed to Railway, the pool, or anywhere on chain.

export interface DecryptedLend {
  intentId: string;
  userId: string;
  token: string;
  amount: number; // converted from string for matching arithmetic
  rate: number; // decrypted from encryptedRate
}

export interface DecryptedBorrow {
  intentId: string;
  borrower: string;
  token: string;
  amount: number;
  maxRate: number; // decrypted from encryptedMaxRate
  collateralToken: string;
  collateralAmount: string;
}

// ---------------------------------------------------------------------------
// Output: matches the engine produces, before and after KMS signing
// ---------------------------------------------------------------------------

export interface MatchedTick {
  /** Lender address, lowercase. */
  lender: string;

  /** The lend intent partially or fully consumed by this tick. */
  lendIntentId: string;

  /** Base-units this tick contributes to the proposal. */
  amount: string;

  /**
   * The lender's own bid rate, decimal in `[0, 1)`.
   * THIS IS WHAT THE LENDER ACTUALLY EARNS ON THIS AMOUNT.
   * Distinct from the borrower's blended rate.
   */
  rate: number;
}

export interface Proposal {
  /** Engine-generated unique ID. Metadata only -- not signed-against. */
  proposalId: string;

  /** The borrow intent this proposal fills. */
  borrowIntentId: string;

  /** Borrower address, lowercase. */
  borrower: string;

  /** Loan asset, lowercase. */
  token: string;

  /** Sum over matchedTicks[].amount, base-units. */
  principal: string;

  matchedTicks: MatchedTick[];

  /** Principal-weighted average rate the borrower pays. */
  effectiveBorrowerRate: number;

  /** Collateral asset, lowercase. */
  collateralToken: string;

  /** Base-units. */
  collateralAmount: string;
}

export interface SignedProposal extends Proposal {
  /** keccak256 of the canonical-encoded proposal. See engine/src/canonical.ts. */
  proposalHash: string;

  /** EIP-191 signature from Orbitport KMS, 0x-prefixed hex (65 bytes: r || s || v). */
  kmsSignature: string;

  /** Orbitport KMS KeyId for traceability. */
  kmsKeyId: string;

  /** The Ethereum address corresponding to the KMS key. Pool verifies against this. */
  kmsAddress: string;
}

// ---------------------------------------------------------------------------
// CRE workflow HTTP boundary
// ---------------------------------------------------------------------------

export interface MatchRequest {
  lendIntents: LendIntent[];
  borrowIntents: BorrowIntent[];
}

export interface MatchResponse {
  proposals: SignedProposal[];
  /** Set if the match round failed wholesale; proposals will be empty. */
  error?: string;
}
