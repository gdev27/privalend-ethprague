import { PrivateKey } from "eciesjs";
import { Buffer } from "node:buffer";

const sk = new PrivateKey();

console.log("=== ECIES KEYPAIR (engine rate decryption) ===");
console.log("PRIVATE (CRE secret as CRE_PRIVATE_KEY):");
console.log("  " + Buffer.from(sk.secret).toString("hex"));
console.log("");
console.log("PUBLIC (give to Person C as CRE_PUBKEY, give to Person A for EngineRegistry):");
console.log("  " + Buffer.from(sk.publicKey.toBytes()).toString("hex"));
