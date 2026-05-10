import { bytesToHex, type Hex } from "viem";
import { normalizeRateString } from "./amounts";
import { publicEnv } from "./env";

export type RateEncryptionMode = "ecies" | "plaintext-dev";

export type EncryptedRate = {
  encryptedRate: Hex | string;
  mode: RateEncryptionMode;
  plaintextRate: string;
};

export async function encryptRateFraction(rate: number): Promise<EncryptedRate> {
  const plaintextRate = normalizeRateString(rate);

  if (!publicEnv.crePublicKey) {
    return {
      encryptedRate: plaintextRate,
      mode: "plaintext-dev",
      plaintextRate,
    };
  }

  const { encrypt } = await import("eciesjs");
  const payload = new TextEncoder().encode(plaintextRate);
  const ciphertext = encrypt(publicEnv.crePublicKey, payload);

  return {
    encryptedRate: bytesToHex(ciphertext),
    mode: "ecies",
    plaintextRate,
  };
}
