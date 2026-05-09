import { cre, Runner, type HTTPPayload, type Runtime } from "@chainlink/cre-sdk";
import { keccak_256 } from "@noble/hashes/sha3";
import { Buffer } from "node:buffer";
import { proposalHash } from "./canonical";
import { runMatchingEngine } from "./engine";
import { createFallbackSigner } from "./fallback-signer";
import { createKmsSigner } from "./kms-signer";
import type { ProposalSigner } from "./signer";
import type { MatchRequest, MatchResponse, Proposal, SignedProposal } from "./types";

export type Config = {
  signerMode: "kms" | "fallback";
  kmsApiUrl?: string;
  kmsKeyId?: string;
  kmsAddress?: string;
  allowInsecureTestSigner?: boolean;
  allowPlaintextRates?: boolean;
};

const ORBITPORT_AUTH = [
  { key: "ORBITPORT_CLIENT_ID", namespace: "privalend" },
  { key: "ORBITPORT_CLIENT_SECRET", namespace: "privalend" },
];

const onMatchRequest = async (
  runtime: Runtime<Config>,
  payload: HTTPPayload,
): Promise<MatchResponse> => {
  try {
    const request = parseMatchRequest(payload);
    runtime.log(
      `matching: ${request.lendIntents.length} lend / ${request.borrowIntents.length} borrow`,
    );

    let crePrivateKey: string | undefined;
    try {
      crePrivateKey = readSecret(runtime, "CRE_PRIVATE_KEY", "CRE_PRIVATE_KEY_ID");
    } catch {
      runtime.log("CRE_PRIVATE_KEY not in secrets; plaintext dev rates only");
    }

    if (request.lendIntents.length === 0 || request.borrowIntents.length === 0) {
      return { proposals: [] };
    }

    const signer = await buildSigner(runtime);
    runtime.log(`using signer: ${signer.label} address=${signer.address}`);

    const proposals: Proposal[] = runMatchingEngine(
      request.lendIntents,
      request.borrowIntents,
      crePrivateKey,
      {
        allowPlaintextRateFallback:
          runtime.config.allowPlaintextRates ?? runtime.config.allowInsecureTestSigner === true,
      },
    );

    const signed: SignedProposal[] = [];
    for (const proposal of proposals) {
      const hash = proposalHash(proposal);
      const signature = await signer.sign(hash);
      signed.push({
        ...proposal,
        proposalHash: hash,
        kmsSignature: signature,
        kmsKeyId: runtime.config.signerMode === "kms"
          ? runtime.config.kmsKeyId ?? "kms"
          : "fallback",
        kmsAddress: signer.address,
      });
    }

    runtime.log(`returning ${signed.length} signed proposals`);
    return { proposals: signed };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    runtime.log(`match failed: ${message}`);
    return { proposals: [], error: message };
  }
};

function parseMatchRequest(payload: HTTPPayload): MatchRequest {
  const text = new TextDecoder().decode(payload.input);
  return JSON.parse(text) as MatchRequest;
}

async function buildSigner(runtime: Runtime<Config>): Promise<ProposalSigner> {
  if (runtime.config.signerMode === "kms") {
    if (!runtime.config.kmsApiUrl || !runtime.config.kmsKeyId || !runtime.config.kmsAddress) {
      throw new Error("kms mode requires kmsApiUrl, kmsKeyId, and kmsAddress");
    }

    return createKmsSigner({
      keyId: runtime.config.kmsKeyId,
      address: runtime.config.kmsAddress,
      signRequest: async (proposalHash) => signWithOrbitport(runtime, proposalHash),
    });
  }

  try {
    const signingKey = readSecret(runtime, "SIGNING_PRIVATE_KEY", "SIGNING_PRIVATE_KEY_ID");
    return createFallbackSigner(signingKey);
  } catch (e) {
    if (!runtime.config.allowInsecureTestSigner) throw e;
    runtime.log("using insecure simulator signer; do not deploy this config");
    return createFallbackSigner(deriveInsecureSimulatorPrivateKey());
  }
}

function readSecret(
  runtime: Runtime<Config>,
  stableId: string,
  cliManifestKey: string,
): string {
  try {
    return runtime.getSecret({ id: stableId }).result().value;
  } catch {
    return runtime.getSecret({ id: cliManifestKey }).result().value;
  }
}

function deriveInsecureSimulatorPrivateKey(): string {
  const seed = new TextEncoder().encode("privalend-insecure-simulator-signer");
  return Buffer.from(keccak_256(seed)).toString("hex");
}

function signWithOrbitport(runtime: Runtime<Config>, hash: string): unknown {
  if (!runtime.config.kmsApiUrl || !runtime.config.kmsKeyId) {
    throw new Error("missing KMS config");
  }

  const token = fetchOrbitportToken(runtime);
  const eip191Hash = eip191Digest(hash);
  const http = new cre.capabilities.ConfidentialHTTPClient();
  const resp = http
    .sendRequest(runtime, {
      vaultDonSecrets: [],
      request: {
        url: `${runtime.config.kmsApiUrl}/api/v1/rpc`,
        method: "POST",
        multiHeaders: {
          authorization: { values: [`Bearer ${token}`] },
          "content-type": { values: ["application/json"] },
          accept: { values: ["application/json"] },
        },
        bodyString: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "kms.Sign",
          params: {
            KeyId: runtime.config.kmsKeyId,
            Message: Buffer.from(eip191Hash).toString("base64"),
            MessageType: "DIGEST",
            SigningAlgorithm: "ETHEREUM_SECP256K1",
          },
        }),
      },
    })
    .result();

  const body = new TextDecoder().decode(resp.body);
  if (resp.statusCode < 200 || resp.statusCode >= 300) {
    throw new Error(`KMS sign failed: ${resp.statusCode} ${body}`);
  }
  return JSON.parse(body);
}

function eip191Digest(proposalHash: string): Uint8Array {
  const innerHashBytes = Buffer.from(proposalHash.slice(2), "hex");
  const prefix = Buffer.from("\x19Ethereum Signed Message:\n32");
  return keccak_256(Buffer.concat([prefix, innerHashBytes]));
}

function fetchOrbitportToken(runtime: Runtime<Config>): string {
  const http = new cre.capabilities.ConfidentialHTTPClient();
  const resp = http
    .sendRequest(runtime, {
      vaultDonSecrets: ORBITPORT_AUTH,
      request: {
        url: "https://auth.spacecomputer.io/oauth/token",
        method: "POST",
        multiHeaders: { "content-type": { values: ["application/json"] } },
        bodyString: JSON.stringify({
          client_id: "{{.ORBITPORT_CLIENT_ID}}",
          client_secret: "{{.ORBITPORT_CLIENT_SECRET}}",
          audience: "https://op.spacecomputer.io/api",
          grant_type: "client_credentials",
        }),
      },
    })
    .result();

  const body = new TextDecoder().decode(resp.body);
  if (resp.statusCode < 200 || resp.statusCode >= 300) {
    throw new Error(`Orbitport auth failed: ${resp.statusCode} ${body}`);
  }
  const data = JSON.parse(body) as { access_token?: string };
  if (!data.access_token) throw new Error("No access_token in Orbitport response");
  return data.access_token;
}

const initWorkflow = () => {
  const http = new cre.capabilities.HTTPCapability();
  return [cre.handler(http.trigger({ authorizedKeys: [] }), onMatchRequest)];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
