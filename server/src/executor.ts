import { ethers } from "ethers";

type StoredProposal = {
  proposalId: string;
  borrowIntentId: string;
  borrower: string;
  token: string;
  principal: string;
  matchedTicks: Array<{
    lender: string;
    lendIntentId: string;
    amount: string;
    rate: number;
  }>;
  effectiveBorrowerRate: number;
  collateralToken: string;
  collateralAmount: string;
  status?: string;
};

type ProposalResponse = { proposals: StoredProposal[] };

const RPC = process.env.SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com";
const EXECUTOR_PRIVATE_KEY = requiredEnv("EXECUTOR_PRIVATE_KEY");
const RAILWAY_URL = stripTrailingSlash(requiredEnv("RAILWAY_URL"));
const MATCHING_COORDINATOR_ADDRESS = requiredEnv("MATCHING_COORDINATOR_ADDRESS");

const ADMIN_KEY = process.env.ADMIN_KEY;
const MIN_COLLATERAL_RATIO_BPS = BigInt(process.env.EXECUTOR_MIN_COLLATERAL_RATIO_BPS || 13_000);
const MATCH_DURATION_SECONDS = BigInt(process.env.EXECUTOR_MATCH_DURATION_SECONDS || 30 * 24 * 60 * 60);
const POLL_MS = Number(process.env.EXECUTOR_POLL_MS || 5000);

const MATCHING_COORDINATOR_ABI = [
  "function currentEpochId() view returns (uint256)",
  "function epochs(uint256) view returns (bool open,bool finalized,uint256 openedAt,uint256 finalizedAt)",
  "function openEpoch() returns (uint256)",
  "function registerMatchDigest(uint256 epochId,bytes32 matchDigest)",
  "function finalizeEpoch(uint256 epochId)",
  "function computeMatchDigest((uint256 epochId,bytes32 borrowIntentId,address borrower,address token,address collateralToken,uint256 principal,uint256 collateralAmount,uint256 weightedRateBps,uint256 minCollateralRatioBps,uint256 durationSeconds,uint256 borrowerNonce,bytes32 salt) params,bytes32[] lendIntentIds,address[] lenders,uint256[] amounts) view returns (bytes32)",
  "function executeMatch((uint256 epochId,bytes32 borrowIntentId,address borrower,address token,address collateralToken,uint256 principal,uint256 collateralAmount,uint256 weightedRateBps,uint256 minCollateralRatioBps,uint256 durationSeconds,uint256 borrowerNonce,bytes32 salt) params,bytes32[] lendIntentIds,address[] lenders,uint256[] amounts) returns (uint256)",
  "event MatchExecuted(uint256 indexed epochId,uint256 indexed loanId,bytes32 indexed matchDigest)",
];

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(EXECUTOR_PRIVATE_KEY, provider);
const coordinator = new ethers.Contract(MATCHING_COORDINATOR_ADDRESS, MATCHING_COORDINATOR_ABI, wallet);
const seen = new Set<string>();
const processing = new Set<string>();
let polling = false;

console.log("[exec] modular executor running");
console.log("[exec] wallet", wallet.address);
console.log("[exec] matchingCoordinator", MATCHING_COORDINATOR_ADDRESS);
console.log("[exec] railway", RAILWAY_URL);

setInterval(() => {
  runTick().catch((e) => console.error("[exec] tick error:", e));
}, POLL_MS);

await runTick().catch((e) => console.error("[exec] first tick error:", e));

async function runTick(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    await tick();
  } finally {
    polling = false;
  }
}

async function tick(): Promise<void> {
  const resp = await fetch(`${RAILWAY_URL}/api/v1/proposals`);
  if (!resp.ok) {
    throw new Error(`proposal fetch failed: ${resp.status} ${await resp.text()}`);
  }

  const { proposals } = (await resp.json()) as ProposalResponse;
  for (const proposal of proposals) {
    if (seen.has(proposal.proposalId) || processing.has(proposal.proposalId)) continue;
    if ((proposal.status ?? "pending") !== "pending") {
      seen.add(proposal.proposalId);
      continue;
    }

    processing.add(proposal.proposalId);
    try {
      const settlement = await toModularSettlement(proposal);
      const digest = await coordinator.computeMatchDigest(
        settlement.params,
        settlement.lendIntentIds,
        settlement.lenders,
        settlement.amounts,
      );

      const registerTx = await coordinator.registerMatchDigest(settlement.params.epochId, digest);
      console.log(`[exec] ${proposal.proposalId} register digest -> ${registerTx.hash}`);
      await registerTx.wait();

      const finalizeTx = await coordinator.finalizeEpoch(settlement.params.epochId);
      console.log(`[exec] ${proposal.proposalId} finalize epoch ${settlement.params.epochId} -> ${finalizeTx.hash}`);
      await finalizeTx.wait();

      const executeTx = await coordinator.executeMatch(
        settlement.params,
        settlement.lendIntentIds,
        settlement.lenders,
        settlement.amounts,
      );
      console.log(`[exec] ${proposal.proposalId} execute match -> ${executeTx.hash}`);
      const receipt = await executeTx.wait();
      const loanId = extractLoanId(receipt);

      seen.add(proposal.proposalId);
      await markProposal(proposal.proposalId, "settled");
      console.log(`[exec] ${proposal.proposalId} settled loan=${loanId ?? "<unknown>"}`);
    } catch (e) {
      console.error(`[exec] ${proposal.proposalId} failed:`, e);
      seen.add(proposal.proposalId);
      await markProposal(proposal.proposalId, "failed").catch((statusError) => {
        console.error(`[exec] ${proposal.proposalId} status update failed:`, statusError);
      });
    } finally {
      processing.delete(proposal.proposalId);
    }
  }
}

async function toModularSettlement(proposal: StoredProposal) {
  if (!isBytes32(proposal.borrowIntentId)) {
    throw new Error(`borrowIntentId is not an on-chain bytes32 id: ${proposal.borrowIntentId}`);
  }
  if (proposal.matchedTicks.length === 0) throw new Error("proposal has no matched ticks");
  for (const tick of proposal.matchedTicks) {
    if (!isBytes32(tick.lendIntentId)) {
      throw new Error(`lendIntentId is not an on-chain bytes32 id: ${tick.lendIntentId}`);
    }
  }

  const epochId = await openOrUseEpoch();
  const lendIntentIds = proposal.matchedTicks.map((tick) => tick.lendIntentId);
  const lenders = proposal.matchedTicks.map((tick) => ethers.getAddress(tick.lender));
  const amounts = proposal.matchedTicks.map((tick) => BigInt(tick.amount));

  return {
    lendIntentIds,
    lenders,
    amounts,
    params: {
      epochId,
      borrowIntentId: proposal.borrowIntentId,
      borrower: ethers.getAddress(proposal.borrower),
      token: ethers.getAddress(proposal.token),
      collateralToken: ethers.getAddress(proposal.collateralToken),
      principal: BigInt(proposal.principal),
      collateralAmount: BigInt(proposal.collateralAmount),
      weightedRateBps: rateToBps(proposal.effectiveBorrowerRate),
      minCollateralRatioBps: MIN_COLLATERAL_RATIO_BPS,
      durationSeconds: MATCH_DURATION_SECONDS,
      borrowerNonce: ethers.toBigInt(ethers.id(proposal.proposalId)),
      salt: ethers.id(`${proposal.proposalId}:${proposal.borrowIntentId}`),
    },
  };
}

async function openOrUseEpoch(): Promise<bigint> {
  const current = (await coordinator.currentEpochId()) as bigint;
  if (current > 0n) {
    const epoch = await coordinator.epochs(current);
    const isOpen = Boolean(epoch.open ?? epoch[0]);
    const isFinalized = Boolean(epoch.finalized ?? epoch[1]);
    if (isOpen && !isFinalized) return current;
  }

  const tx = await coordinator.openEpoch();
  console.log(`[exec] open epoch -> ${tx.hash}`);
  await tx.wait();
  return (await coordinator.currentEpochId()) as bigint;
}

function extractLoanId(receipt: ethers.TransactionReceipt | null) {
  if (!receipt) return undefined;
  for (const log of receipt.logs) {
    try {
      const parsed = coordinator.interface.parseLog(log);
      if (parsed?.name === "MatchExecuted") return parsed.args.loanId?.toString();
    } catch {
      // Ignore logs from other contracts.
    }
  }
  return undefined;
}

async function markProposal(proposalId: string, status: "settled" | "failed") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (ADMIN_KEY) headers["x-admin-key"] = ADMIN_KEY;
  const resp = await fetch(`${RAILWAY_URL}/api/v1/proposals/${proposalId}/status`, {
    method: "POST",
    headers,
    body: JSON.stringify({ status }),
  });
  if (!resp.ok) {
    throw new Error(`status update failed: ${resp.status} ${await resp.text()}`);
  }
}

function rateToBps(rate: number): bigint {
  return BigInt(Math.round(rate * 10_000));
}

function isBytes32(value: string): boolean {
  return ethers.isHexString(value, 32);
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
