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
  proposalHash: string;
  kmsSignature: string;
  status?: string;
};

type ProposalResponse = { proposals: StoredProposal[] };

const RPC = process.env.SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com";
const POOL_ADDRESS = requiredEnv("POOL_ADDRESS");
const EXECUTOR_PRIVATE_KEY = requiredEnv("EXECUTOR_PRIVATE_KEY");
const RAILWAY_URL = stripTrailingSlash(requiredEnv("RAILWAY_URL"));

const POLL_MS = Number(process.env.EXECUTOR_POLL_MS || 5000);

const POOL_ABI = [
  "function settleMatch((string proposalId,string borrowIntentId,address borrower,address token,uint256 principal,(address lender,string lendIntentId,uint256 amount,uint256 rate)[] matchedTicks,uint256 effectiveBorrowerRate,address collateralToken,uint256 collateralAmount,bytes32 proposalHash,bytes kmsSignature) proposal) external",
  "event LoanMatched(bytes32 indexed proposalId,address indexed borrower,uint256 principal)",
];

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(EXECUTOR_PRIVATE_KEY, provider);
const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, wallet);
const seen = new Set<string>();

console.log("[exec] executor running");
console.log("[exec] wallet", wallet.address);
console.log("[exec] pool", POOL_ADDRESS);
console.log("[exec] railway", RAILWAY_URL);

setInterval(() => {
  tick().catch((e) => console.error("[exec] tick error:", e));
}, POLL_MS);

await tick().catch((e) => console.error("[exec] first tick error:", e));

async function tick(): Promise<void> {
  const resp = await fetch(`${RAILWAY_URL}/api/v1/proposals`);
  if (!resp.ok) {
    throw new Error(`proposal fetch failed: ${resp.status} ${await resp.text()}`);
  }

  const { proposals } = (await resp.json()) as ProposalResponse;
  for (const proposal of proposals) {
    if (seen.has(proposal.proposalId)) continue;
    if (proposal.status !== "pending") {
      seen.add(proposal.proposalId);
      continue;
    }

    try {
      const tx = await pool.settleMatch(toContractProposal(proposal));
      console.log(`[exec] ${proposal.proposalId} -> tx ${tx.hash}`);
      await tx.wait();
      seen.add(proposal.proposalId);
      console.log(`[exec] ${proposal.proposalId} settled`);
    } catch (e) {
      console.error(`[exec] ${proposal.proposalId} failed:`, e);
      seen.add(proposal.proposalId);
    }
  }
}

function toContractProposal(proposal: StoredProposal) {
  return {
    proposalId: proposal.proposalId,
    borrowIntentId: proposal.borrowIntentId,
    borrower: proposal.borrower,
    token: proposal.token,
    principal: BigInt(proposal.principal),
    matchedTicks: proposal.matchedTicks.map((tick) => ({
      lender: tick.lender,
      lendIntentId: tick.lendIntentId,
      amount: BigInt(tick.amount),
      rate: rateToWad(tick.rate),
    })),
    effectiveBorrowerRate: rateToWad(proposal.effectiveBorrowerRate),
    collateralToken: proposal.collateralToken,
    collateralAmount: BigInt(proposal.collateralAmount),
    proposalHash: proposal.proposalHash,
    kmsSignature: proposal.kmsSignature,
  };
}

function rateToWad(rate: number): bigint {
  return BigInt(Math.round(rate * 1e18));
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
