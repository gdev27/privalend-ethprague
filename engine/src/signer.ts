export interface ProposalSigner {
  /** The Ethereum address this signer signs as. Pinned in EngineRegistry. */
  readonly address: string;
  /** Label for logs and diagnostics. */
  readonly label: "kms" | "fallback";
  /**
   * Sign the EIP-191-prefixed keccak256 of `proposalHash`.
   *
   * @param proposalHash 0x-prefixed 32-byte hex string.
   * @returns 0x-prefixed 65-byte signature (r || s || v), v in {27, 28}.
   */
  sign(proposalHash: string): Promise<string>;
}
