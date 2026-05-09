import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { Buffer } from "node:buffer";
import type { ProposalSigner } from "./signer";

export interface KmsSignerConfig {
  keyId: string;
  address: string;
  signRequest: (proposalHash: string) => Promise<unknown>;
}

export function createKmsSigner(cfg: KmsSignerConfig): ProposalSigner {
  return {
    address: cfg.address.toLowerCase(),
    label: "kms",
    async sign(proposalHash: string): Promise<string> {
      const data = await cfg.signRequest(proposalHash);
      const sigRaw = extractSignature(data);
      const sigBytes = decodeSignatureBytes(sigRaw);
      if (sigBytes.length === 65) {
        return normalizeEthSignature(sigBytes);
      }

      const eip191Hash = hashPersonalMessage32(proposalHash);
      return derToEthSig(Buffer.from(sigBytes), eip191Hash, cfg.address);
    },
  };
}

function normalizeEthSignature(signature: Uint8Array): string {
  const bytes = Buffer.from(signature);
  if (bytes[64] < 27) bytes[64] += 27;
  if (bytes[64] !== 27 && bytes[64] !== 28) {
    throw new Error(`unexpected Ethereum recovery byte: ${bytes[64]}`);
  }
  return "0x" + bytes.toString("hex");
}

function extractSignature(data: unknown): string {
  const obj = data as Record<string, unknown>;
  const result = obj.result as Record<string, unknown> | undefined;
  const signature =
    obj.Signature || obj.signature || result?.Signature || result?.signature;
  if (typeof signature !== "string" || !signature) {
    throw new Error("No signature in KMS response: " + JSON.stringify(data));
  }
  return signature;
}

function decodeSignatureBytes(signature: string): Uint8Array {
  if (signature.startsWith("0x")) {
    return Buffer.from(signature.slice(2), "hex");
  }
  if (/^[0-9a-f]+$/i.test(signature) && signature.length % 2 === 0) {
    return Buffer.from(signature, "hex");
  }
  return Buffer.from(signature, "base64");
}

function hashPersonalMessage32(proposalHash: string): Uint8Array {
  const innerHashBytes = Buffer.from(proposalHash.slice(2), "hex");
  const prefix = Buffer.from("\x19Ethereum Signed Message:\n32");
  return keccak_256(Buffer.concat([prefix, innerHashBytes]));
}

function derToEthSig(
  der: Buffer,
  eip191Hash: Uint8Array,
  expectedAddress: string,
): string {
  if (der[0] !== 0x30) throw new Error("bad DER (no sequence)");
  let offset = 2;

  if (der[offset] !== 0x02) throw new Error("bad DER (no r tag)");
  const rLength = der[offset + 1];
  offset += 2;
  let r = der.subarray(offset, offset + rLength);
  offset += rLength;

  if (der[offset] !== 0x02) throw new Error("bad DER (no s tag)");
  const sLength = der[offset + 1];
  offset += 2;
  let s = der.subarray(offset, offset + sLength);

  if (r[0] === 0x00) r = r.subarray(1);
  if (s[0] === 0x00) s = s.subarray(1);
  if (r.length > 32 || s.length > 32) throw new Error("bad DER (oversized r/s)");

  const r32 = Buffer.concat([Buffer.alloc(32 - r.length), r]);
  let s32 = Buffer.concat([Buffer.alloc(32 - s.length), s]);

  const curveOrder = secp256k1.CURVE.n;
  const sBig = BigInt("0x" + s32.toString("hex"));
  if (sBig > curveOrder / 2n) {
    s32 = Buffer.from((curveOrder - sBig).toString(16).padStart(64, "0"), "hex");
  }

  for (const recovery of [0, 1] as const) {
    const sig = new secp256k1.Signature(
      BigInt("0x" + r32.toString("hex")),
      BigInt("0x" + s32.toString("hex")),
    ).addRecoveryBit(recovery);
    const pub = sig.recoverPublicKey(eip191Hash).toRawBytes(false).slice(1);
    const address = "0x" + Buffer.from(keccak_256(pub).slice(-20)).toString("hex");
    if (address.toLowerCase() === expectedAddress.toLowerCase()) {
      const v = (recovery + 27).toString(16).padStart(2, "0");
      return "0x" + r32.toString("hex") + s32.toString("hex") + v;
    }
  }

  throw new Error("could not recover DER signature to expected address");
}
