import { keccak_256 } from "@noble/hashes/sha3";
import { Buffer } from "node:buffer";
import { proposalHash } from "../src/canonical";
import { runMatchingEngine } from "../src/engine";
import { createFallbackSigner } from "../src/fallback-signer";
import type { MatchRequest, MatchResponse, SignedProposal } from "../src/types";

const port = Number(process.env.LOCAL_WORKFLOW_PORT || 4010);
const signer = createFallbackSigner(deriveInsecureSimulatorPrivateKey());

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, signer: signer.address });
    }
    if (req.method !== "POST" || url.pathname !== "/match") {
      return Response.json({ error: "not found" }, { status: 404 });
    }

    try {
      const payload = (await req.json()) as MatchRequest;
      const proposals = runMatchingEngine(payload.lendIntents, payload.borrowIntents);
      const signed: SignedProposal[] = [];
      for (const proposal of proposals) {
        const hash = proposalHash(proposal);
        signed.push({
          ...proposal,
          proposalHash: hash,
          kmsSignature: await signer.sign(hash),
          kmsKeyId: "fallback-local",
          kmsAddress: signer.address,
        });
      }
      const body: MatchResponse = { proposals: signed };
      return Response.json(body);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return Response.json({ proposals: [], error: message } satisfies MatchResponse, {
        status: 500,
      });
    }
  },
});

console.log(`Local PrivaLend workflow endpoint listening on http://localhost:${port}/match`);
console.log(`Signer: ${signer.address}`);

function deriveInsecureSimulatorPrivateKey(): string {
  const seed = new TextEncoder().encode("privalend-insecure-simulator-signer");
  return Buffer.from(keccak_256(seed)).toString("hex");
}
