import { encrypt } from "eciesjs";
import { Buffer } from "buffer";

// Replace with the public key printed by `cd engine && bun run keypair`.
export const CRE_PUBKEY = "REPLACE_WITH_HEX_PUBKEY";

export function encryptRate(ratePercent: number): string {
  const rateString = (ratePercent / 100).toFixed(4);
  const ciphertext = encrypt(CRE_PUBKEY, Buffer.from(rateString));
  return "0x" + Buffer.from(ciphertext).toString("hex");
}
