import { AbiCoder, concat, getAddress, id, keccak256 } from "ethers";
import type { Proposal } from "./types";

const abiCoder = AbiCoder.defaultAbiCoder();

/**
 * Canonical encoding of a proposal for hashing.
 *
 * This mirrors PrivaLendPool.computeProposalHash:
 * keccak256(abi.encode(idsHash, matchedTicksHash, termsHash)).
 */
export function canonicalEncode(p: Proposal): string {
  return abiCoder.encode(["bytes32", "bytes32", "bytes32"], proposalHashParts(p));
}

export function proposalHash(p: Proposal): string {
  return keccak256(canonicalEncode(p));
}

export function rateToWad(rate: number): bigint {
  return BigInt(Math.round(rate * 1e18));
}

function proposalHashParts(p: Proposal): [string, string, string] {
  const idsHash = keccak256(
    abiCoder.encode(["bytes32", "bytes32"], [id(p.proposalId), id(p.borrowIntentId)]),
  );
  const matchedTicksHash = keccak256(
    concat(
      p.matchedTicks.map((t) =>
        keccak256(
          abiCoder.encode(
            ["address", "bytes32", "uint256", "uint256"],
            [getAddress(t.lender), id(t.lendIntentId), BigInt(t.amount), rateToWad(t.rate)],
          ),
        ),
      ),
    ),
  );
  const termsHash = keccak256(
    abiCoder.encode(
      ["address", "address", "uint256", "uint256", "address", "uint256"],
      [
        getAddress(p.borrower),
        getAddress(p.token),
        BigInt(p.principal),
        rateToWad(p.effectiveBorrowerRate),
        getAddress(p.collateralToken),
        BigInt(p.collateralAmount),
      ],
    ),
  );

  return [idsHash, matchedTicksHash, termsHash];
}
