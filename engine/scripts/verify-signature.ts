// Recover the signer of a proposal signature locally.
// Usage: bun run scripts/verify-signature.ts <proposalHash> <signature> <expectedAddress>

import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { Buffer } from "node:buffer";

const [, , proposalHash, signature, expectedAddress] = process.argv;
if (!proposalHash || !signature || !expectedAddress) {
  console.error(
    "Usage: bun run scripts/verify-signature.ts <hash> <sig> <expectedAddr>",
  );
  process.exit(1);
}

const innerHashBytes = Buffer.from(proposalHash.slice(2), "hex");
const prefix = Buffer.from("\x19Ethereum Signed Message:\n32");
const eip191Hash = keccak_256(Buffer.concat([prefix, innerHashBytes]));

const sigHex = signature.startsWith("0x") ? signature.slice(2) : signature;
const r = BigInt("0x" + sigHex.slice(0, 64));
const s = BigInt("0x" + sigHex.slice(64, 128));
const v = Number.parseInt(sigHex.slice(128, 130), 16);

const sig = new secp256k1.Signature(r, s).addRecoveryBit(v - 27);
const pub = sig.recoverPublicKey(eip191Hash).toRawBytes(false).slice(1);
const addr = "0x" + Buffer.from(keccak_256(pub).slice(-20)).toString("hex");

console.log("Expected :", expectedAddress.toLowerCase());
console.log("Recovered:", addr);
console.log(addr.toLowerCase() === expectedAddress.toLowerCase() ? "match" : "mismatch");
