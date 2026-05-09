import { decrypt } from "eciesjs";
import { Buffer } from "node:buffer";

/**
 * Decrypt an ECIES-encrypted rate ciphertext.
 *
 * In non-production workflows, a plaintext decimal string in (0, 1) is accepted
 * to keep local tests and demos simple. Production callers must provide a real
 * ECIES ciphertext plus private key.
 */
export function decryptRate(encryptedRate: string, privateKeyHex?: string): number {
  return decryptRateWithOptions(encryptedRate, privateKeyHex, true);
}

export function decryptRateWithOptions(
  encryptedRate: string,
  privateKeyHex: string | undefined,
  plaintextFallbackAllowed: boolean,
): number {
  const parsed = Number(encryptedRate);
  if (
    plaintextFallbackAllowed &&
    Number.isFinite(parsed) &&
    parsed > 0 &&
    parsed < 1
  ) {
    return parsed;
  }

  if (privateKeyHex) {
    try {
      const stripped = encryptedRate.startsWith("0x")
        ? encryptedRate.slice(2)
        : encryptedRate;
      const ciphertext = Buffer.from(stripped, "hex");
      const decrypted = decrypt(privateKeyHex, ciphertext);
      const rate = Number(new TextDecoder().decode(decrypted));
      if (Number.isFinite(rate) && rate > 0 && rate < 1) {
        return rate;
      }
    } catch {
      // Fall through to the deterministic default below.
    }
  }

  return 0.05;
}
