import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { Buffer } from "node:buffer";
import { getAccessToken } from "./orbitport-auth";

const API = process.env.ORBITPORT_API_URL || "https://op.spacecomputer.io";

type JsonObject = Record<string, unknown>;

async function call(path: string, body?: unknown): Promise<JsonObject> {
  const token = await getAccessToken();
  const resp = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  console.log(`[${resp.status}] POST ${path}`);
  console.log("        ->", text.slice(0, 500));
  if (!resp.ok) {
    const error = new Error(`${path} -> ${resp.status}`);
    (error as Error & { status?: number }).status = resp.status;
    throw error;
  }
  return JSON.parse(text) as JsonObject;
}

async function createKey(): Promise<{ keyId: string; address: string }> {
  if (process.env.KMS_KEY_ID && process.env.KMS_ADDRESS) {
    return { keyId: process.env.KMS_KEY_ID, address: process.env.KMS_ADDRESS };
  }

  const attempts: Array<{ path: string; body: unknown }> = [
    {
      path: "/api/v1/rpc",
      body: {
        jsonrpc: "2.0" as const,
        id: 1,
        method: "kms.CreateKey",
        params: {
          Alias: `privalend-${Date.now()}`,
          KeySpec: "ECC_SECG_P256K1",
          KeyUsage: "SIGN_VERIFY",
          Scheme: "ETHEREUM",
          Description: "PrivaLend hackathon settlement signer",
          Tags: [],
        },
      },
    },
  ];

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      const created = await call(attempt.path, attempt.body);
      const keyId =
        (created.KeyId as string | undefined) ||
        (created.keyId as string | undefined) ||
        ((created.KeyMetadata as JsonObject | undefined)?.KeyId as string | undefined) ||
        ((created.result as JsonObject | undefined)?.KeyId as string | undefined) ||
        ((created.result as JsonObject | undefined)?.keyId as string | undefined) ||
        (((created.result as JsonObject | undefined)?.KeyMetadata as JsonObject | undefined)
          ?.KeyId as string | undefined);
      const address =
        (created.Address as string | undefined) ||
        (created.address as string | undefined) ||
        ((created.KeyMetadata as JsonObject | undefined)?.Address as string | undefined) ||
        ((created.result as JsonObject | undefined)?.Address as string | undefined) ||
        ((created.result as JsonObject | undefined)?.address as string | undefined) ||
        (((created.result as JsonObject | undefined)?.KeyMetadata as JsonObject | undefined)
          ?.Address as string | undefined);
      if (!keyId || !address) {
        throw new Error("Could not find KeyId/Address in response: " + JSON.stringify(created));
      }
      return { keyId, address };
    } catch (e) {
      lastError = e;
      const status = (e as Error & { status?: number }).status;
      if (status !== 404) break;
      console.warn("createKey attempt failed; trying next shape:", e);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function signHash(keyId: string, proposalHash: string): Promise<string> {
  const eip191Hash = hashPersonalMessage32(proposalHash);
  const attempts: Array<{ path: string; body: unknown }> = [
    {
      path: "/api/v1/rpc",
      body: {
        jsonrpc: "2.0",
        id: 2,
        method: "kms.Sign",
        params: {
          KeyId: keyId,
          Message: Buffer.from(eip191Hash).toString("base64"),
          MessageType: "DIGEST",
          SigningAlgorithm: "ETHEREUM_SECP256K1",
        },
      },
    },
  ];

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      const signed = await call(attempt.path, attempt.body);
      const signature =
        (signed.Signature as string | undefined) ||
        (signed.signature as string | undefined) ||
        ((signed.result as JsonObject | undefined)?.Signature as string | undefined) ||
        ((signed.result as JsonObject | undefined)?.signature as string | undefined);
      if (!signature) {
        throw new Error("Could not find Signature in response: " + JSON.stringify(signed));
      }
      return signature;
    } catch (e) {
      lastError = e;
      const status = (e as Error & { status?: number }).status;
      if (status !== 404) break;
      console.warn("sign attempt failed; trying next shape:", e);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function recoverAddress(proposalHash: string, signature: string): string {
  const eip191Hash = hashPersonalMessage32(proposalHash);

  const sigHex = signature.startsWith("0x") ? signature.slice(2) : signature;
  if (sigHex.length !== 130) {
    throw new Error(
      `Signature is not 65 bytes (${sigHex.length / 2} bytes). DER conversion is handled in src/kms-signer.ts.`,
    );
  }
  const r = BigInt("0x" + sigHex.slice(0, 64));
  const s = BigInt("0x" + sigHex.slice(64, 128));
  const v = Number.parseInt(sigHex.slice(128, 130), 16);

  const sig = new secp256k1.Signature(r, s).addRecoveryBit(v >= 27 ? v - 27 : v);
  const pub = sig.recoverPublicKey(eip191Hash).toRawBytes(false).slice(1);
  return "0x" + Buffer.from(keccak_256(pub).slice(-20)).toString("hex");
}

function hashPersonalMessage32(proposalHash: string): Uint8Array {
  const innerHashBytes = Buffer.from(proposalHash.slice(2), "hex");
  const prefix = Buffer.from("\x19Ethereum Signed Message:\n32");
  return keccak_256(Buffer.concat([prefix, innerHashBytes]));
}

(async () => {
  const { keyId, address } = await createKey();
  console.log("\nKey created");
  console.log("KeyId  :", keyId);
  console.log("Address:", address);

  const message = "hello privalend";
  const proposalHash = "0x" + Buffer.from(keccak_256(Buffer.from(message))).toString("hex");
  console.log("\nInner hash:", proposalHash);

  const signature = await signHash(keyId, proposalHash);
  console.log("\nSignature returned");
  console.log("Length:", signature.length);
  console.log("Sig   :", signature);

  const recoveredAddress = recoverAddress(proposalHash, signature);
  console.log("\nRecovered:", recoveredAddress);
  console.log("Expected :", address.toLowerCase());

  if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
    throw new Error("Recovered signer does not match expected address");
  }

  console.log("\nKMS sign + recover roundtrip works.");
})();
