import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { Buffer } from "node:buffer";
import type { ProposalSigner } from "./signer";

export function createFallbackSigner(privateKeyHex: string): ProposalSigner {
  const stripped = privateKeyHex.startsWith("0x")
    ? privateKeyHex.slice(2)
    : privateKeyHex;
  const privateKey = Buffer.from(stripped, "hex");
  const publicKey = secp256k1.getPublicKey(privateKey, false).slice(1);
  const address = "0x" + Buffer.from(keccak_256(publicKey).slice(-20)).toString("hex");

  return {
    address,
    label: "fallback",
    async sign(proposalHash: string): Promise<string> {
      const eip191Hash = hashPersonalMessage32(proposalHash);
      const sig = secp256k1.sign(eip191Hash, privateKey, { lowS: true });
      const recovery = sig.recovery;
      if (recovery === undefined) {
        throw new Error("fallback signer did not produce a recovery bit");
      }

      const r = sig.r.toString(16).padStart(64, "0");
      const s = sig.s.toString(16).padStart(64, "0");
      const v = (recovery + 27).toString(16).padStart(2, "0");
      return "0x" + r + s + v;
    },
  };
}

function hashPersonalMessage32(proposalHash: string): Uint8Array {
  const innerHashBytes = Buffer.from(proposalHash.slice(2), "hex");
  const prefix = Buffer.from("\x19Ethereum Signed Message:\n32");
  return keccak_256(Buffer.concat([prefix, innerHashBytes]));
}
