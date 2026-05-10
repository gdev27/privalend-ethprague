"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address, Hex, PublicClient } from "viem";
import { zeroAddress } from "viem";
import { useAccount, useChainId, usePublicClient, useReadContracts, useSwitchChain, useWriteContract } from "wagmi";
import { erc20Abi, privaLendPoolAbi } from "./abis";
import {
  FALLBACK_COLLATERAL_DECIMALS,
  FALLBACK_DEBT_DECIMALS,
  parseHumanAmount,
} from "./amounts";
import {
  getProposals,
  postBorrowIntent,
  postDemoTick,
  postLendIntent,
  type PostedIntent,
  type SignedProposal,
} from "./api";
import { encryptRateFraction, type RateEncryptionMode } from "./encryption";
import { publicEnv } from "./env";
import { proposalInvolvesAddress, proposalToSettleArgs, stringIdToBytes32 } from "./proposals";

export type TokenState = {
  address: Address;
  allowance: bigint;
  balance: bigint;
  decimals: number;
  isLoading: boolean;
  symbol: string;
};

export type PoolLoanStatus = 0 | 1 | 2;

export type PoolLoan = {
  borrower: Address;
  collateralAmount: bigint;
  collateralToken: Address;
  effectiveBorrowerRate: bigint;
  lenderClaimable: bigint;
  lenderPrincipal: bigint;
  lenders: Address[];
  loanId: bigint;
  matchedProposal?: SignedProposal;
  outstandingPrincipal: bigint;
  principal: bigint;
  proposalIdHash: Hex;
  role: "borrower" | "lender" | "both";
  status: PoolLoanStatus;
  token: Address;
};

export type RelevantProposal = SignedProposal & {
  settledOnChain: boolean;
};

export type SubmitLendInput = {
  amount: bigint;
  minimumRate: number;
};

export type SubmitBorrowInput = {
  amount: bigint;
  collateralAmount: bigint;
  maxRate: number;
};

export type ProtocolState = {
  actionLabel: string | null;
  actionPending: boolean;
  address?: Address;
  backendReachable: boolean | null;
  collateralToken: TokenState;
  debtToken: TokenState;
  encryptionMode: RateEncryptionMode;
  isConnected: boolean;
  isCorrectChain: boolean;
  lastError: string | null;
  lastPollAt: number | null;
  loans: PoolLoan[];
  postedIntents: PostedIntent[];
  proposals: RelevantProposal[];
  role: "borrower" | "lender" | "both" | "none";
  approveCollateral: (amount: bigint) => Promise<void>;
  approveDebt: (amount: bigint) => Promise<void>;
  clearError: () => void;
  closePosition: (loan: PoolLoan) => Promise<void>;
  parseCollateralAmount: (value: string) => bigint | null;
  parseDebtAmount: (value: string) => bigint | null;
  refreshAll: () => Promise<void>;
  repay: (loan: PoolLoan, amount?: bigint) => Promise<void>;
  runDemoTick: () => Promise<void>;
  settleProposal: (proposal: SignedProposal) => Promise<void>;
  submitBorrow: (input: SubmitBorrowInput) => Promise<void>;
  submitLend: (input: SubmitLendInput) => Promise<void>;
  switchToDemoChain: () => Promise<void>;
  withdrawClaim: (loan: PoolLoan) => Promise<void>;
};

type PoolLoanTuple = {
  id: bigint;
  proposalIdHash: Hex;
  borrower: Address;
  token: Address;
  collateralToken: Address;
  principal: bigint;
  outstandingPrincipal: bigint;
  collateralAmount: bigint;
  effectiveBorrowerRate: bigint;
  status: number;
};

const emptyToken = (address: Address, symbol: string, decimals: number): TokenState => ({
  address,
  allowance: 0n,
  balance: 0n,
  decimals,
  isLoading: false,
  symbol,
});

export function usePrivaLendProtocol(): ProtocolState {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: publicEnv.chainId });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [actionLabel, setActionLabel] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [backendReachable, setBackendReachable] = useState<boolean | null>(null);
  const [lastPollAt, setLastPollAt] = useState<number | null>(null);
  const [postedIntents, setPostedIntents] = useState<PostedIntent[]>([]);
  const [proposals, setProposals] = useState<SignedProposal[]>([]);
  const [settlementState, setSettlementState] = useState<Record<string, boolean>>({});
  const [loans, setLoans] = useState<PoolLoan[]>([]);

  const isCorrectChain = chainId === publicEnv.chainId;

  const tokenReads = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: publicEnv.debtTokenAddress, abi: erc20Abi, functionName: "decimals" },
      { address: publicEnv.debtTokenAddress, abi: erc20Abi, functionName: "symbol" },
      { address: publicEnv.debtTokenAddress, abi: erc20Abi, functionName: "balanceOf", args: [address ?? zeroAddress] },
      { address: publicEnv.debtTokenAddress, abi: erc20Abi, functionName: "allowance", args: [address ?? zeroAddress, publicEnv.poolAddress] },
      { address: publicEnv.collateralTokenAddress, abi: erc20Abi, functionName: "decimals" },
      { address: publicEnv.collateralTokenAddress, abi: erc20Abi, functionName: "symbol" },
      { address: publicEnv.collateralTokenAddress, abi: erc20Abi, functionName: "balanceOf", args: [address ?? zeroAddress] },
      { address: publicEnv.collateralTokenAddress, abi: erc20Abi, functionName: "allowance", args: [address ?? zeroAddress, publicEnv.poolAddress] },
    ],
    query: {
      enabled: Boolean(address && isCorrectChain),
      refetchInterval: 6_000,
    },
  });

  const debtToken = useMemo(
    () =>
      readTokenState({
        address: publicEnv.debtTokenAddress,
        fallbackDecimals: FALLBACK_DEBT_DECIMALS,
        fallbackSymbol: "USDC",
        isLoading: tokenReads.isLoading,
        results: tokenReads.data?.slice(0, 4),
      }),
    [tokenReads.data, tokenReads.isLoading],
  );

  const collateralToken = useMemo(
    () =>
      readTokenState({
        address: publicEnv.collateralTokenAddress,
        fallbackDecimals: FALLBACK_COLLATERAL_DECIMALS,
        fallbackSymbol: "WETH",
        isLoading: tokenReads.isLoading,
        results: tokenReads.data?.slice(4, 8),
      }),
    [tokenReads.data, tokenReads.isLoading],
  );

  const relevantProposals = useMemo<RelevantProposal[]>(() => {
    if (!address) return [];
    return proposals
      .filter((proposal) => proposalInvolvesAddress(proposal, address))
      .map((proposal) => ({
        ...proposal,
        settledOnChain: settlementState[proposal.proposalId] ?? false,
      }));
  }, [address, proposals, settlementState]);

  const role = useMemo(() => {
    const hasBorrower =
      postedIntents.some((intent) => intent.side === "borrow") ||
      relevantProposals.some((proposal) => proposal.borrower.toLowerCase() === address?.toLowerCase()) ||
      loans.some((loan) => loan.role === "borrower" || loan.role === "both");
    const hasLender =
      postedIntents.some((intent) => intent.side === "lend") ||
      relevantProposals.some((proposal) => proposal.matchedTicks.some((tick) => tick.lender.toLowerCase() === address?.toLowerCase())) ||
      loans.some((loan) => loan.role === "lender" || loan.role === "both");

    if (hasBorrower && hasLender) return "both";
    if (hasBorrower) return "borrower";
    if (hasLender) return "lender";
    return "none";
  }, [address, loans, postedIntents, relevantProposals]);

  useEffect(() => {
    if (!address) {
      setPostedIntents([]);
      return;
    }

    setPostedIntents(loadPostedIntents(address));
  }, [address]);

  const refreshProposals = useCallback(async () => {
    try {
      const data = await getProposals();
      setBackendReachable(true);
      setLastPollAt(Date.now());
      setProposals(data.proposals);

      if (address && publicClient) {
        const relevant = data.proposals.filter((proposal) => proposalInvolvesAddress(proposal, address));
        const states = await fetchProposalSettlementStates(publicClient as PublicClient, relevant);
        setSettlementState(states);
      }
    } catch (error) {
      setBackendReachable(false);
      setLastError(errorMessage(error));
    }
  }, [address, publicClient]);

  const refreshLoans = useCallback(async () => {
    if (!address || !publicClient || !isCorrectChain) {
      setLoans([]);
      return;
    }

    try {
      const nextLoans = await fetchSignedPoolLoans(publicClient as PublicClient, address, proposals);
      setLoans(nextLoans);
    } catch (error) {
      setLastError(errorMessage(error));
    }
  }, [address, isCorrectChain, proposals, publicClient]);

  const refreshAll = useCallback(async () => {
    await Promise.all([tokenReads.refetch(), refreshProposals(), refreshLoans()]);
  }, [refreshLoans, refreshProposals, tokenReads]);

  useEffect(() => {
    void refreshProposals();
    const interval = window.setInterval(() => {
      void refreshProposals();
    }, 2_000);

    return () => window.clearInterval(interval);
  }, [refreshProposals]);

  useEffect(() => {
    void refreshLoans();
    const interval = window.setInterval(() => {
      void refreshLoans();
    }, 5_000);

    return () => window.clearInterval(interval);
  }, [refreshLoans]);

  const switchToDemoChain = useCallback(async () => {
    await switchChainAsync({ chainId: publicEnv.chainId });
  }, [switchChainAsync]);

  const approveDebt = useCallback(
    async (amount: bigint) => {
      await runWalletAction("Approving USDC", async () => {
        const hash = await writeContractAsync({
          address: publicEnv.debtTokenAddress,
          abi: erc20Abi,
          functionName: "approve",
          args: [publicEnv.poolAddress, amount],
          chainId: publicEnv.chainId,
        });
        await waitForReceipt(publicClient as PublicClient | undefined, hash);
        await refreshAll();
      }, setActionLabel, setLastError);
    },
    [publicClient, refreshAll, writeContractAsync],
  );

  const approveCollateral = useCallback(
    async (amount: bigint) => {
      await runWalletAction("Approving WETH", async () => {
        const hash = await writeContractAsync({
          address: publicEnv.collateralTokenAddress,
          abi: erc20Abi,
          functionName: "approve",
          args: [publicEnv.poolAddress, amount],
          chainId: publicEnv.chainId,
        });
        await waitForReceipt(publicClient as PublicClient | undefined, hash);
        await refreshAll();
      }, setActionLabel, setLastError);
    },
    [publicClient, refreshAll, writeContractAsync],
  );

  const submitLend = useCallback(
    async ({ amount, minimumRate }: SubmitLendInput) => {
      if (!address) throw new Error("Connect a lender wallet first");

      await runWalletAction("Submitting lend offer", async () => {
        const encrypted = await encryptRateFraction(minimumRate);
        const { intent } = await postLendIntent({
          lenderAddress: address,
          tokenAddress: publicEnv.debtTokenAddress,
          amount,
          encryptedRate: encrypted.encryptedRate,
        });
        rememberPostedIntent(address, {
          side: "lend",
          intentId: intent.intentId,
          address,
          amount: intent.amount,
          rate: minimumRate,
          createdAt: intent.createdAt,
        }, setPostedIntents);
        await refreshProposals();
      }, setActionLabel, setLastError);
    },
    [address, refreshProposals],
  );

  const submitBorrow = useCallback(
    async ({ amount, collateralAmount, maxRate }: SubmitBorrowInput) => {
      if (!address) throw new Error("Connect a borrower wallet first");

      await runWalletAction("Submitting borrow request", async () => {
        const encrypted = await encryptRateFraction(maxRate);
        const { intent } = await postBorrowIntent({
          borrowerAddress: address,
          tokenAddress: publicEnv.debtTokenAddress,
          amount,
          encryptedMaxRate: encrypted.encryptedRate,
          collateralTokenAddress: publicEnv.collateralTokenAddress,
          collateralAmount,
        });
        rememberPostedIntent(address, {
          side: "borrow",
          intentId: intent.intentId,
          address,
          amount: intent.amount,
          rate: maxRate,
          createdAt: intent.createdAt,
        }, setPostedIntents);
        await refreshProposals();
      }, setActionLabel, setLastError);
    },
    [address, refreshProposals],
  );

  const settleProposal = useCallback(
    async (proposal: SignedProposal) => {
      await runWalletAction("Settling match", async () => {
        const hash = await writeContractAsync({
          address: publicEnv.poolAddress,
          abi: privaLendPoolAbi,
          functionName: "settleMatch",
          args: proposalToSettleArgs(proposal),
          chainId: publicEnv.chainId,
        });
        await waitForReceipt(publicClient as PublicClient | undefined, hash);
        await refreshAll();
      }, setActionLabel, setLastError);
    },
    [publicClient, refreshAll, writeContractAsync],
  );

  const repay = useCallback(
    async (loan: PoolLoan, amount = loan.outstandingPrincipal) => {
      await runWalletAction("Repaying loan", async () => {
        const hash = await writeContractAsync({
          address: publicEnv.poolAddress,
          abi: privaLendPoolAbi,
          functionName: "repay",
          args: [loan.loanId, amount],
          chainId: publicEnv.chainId,
        });
        await waitForReceipt(publicClient as PublicClient | undefined, hash);
        await refreshAll();
      }, setActionLabel, setLastError);
    },
    [publicClient, refreshAll, writeContractAsync],
  );

  const withdrawClaim = useCallback(
    async (loan: PoolLoan) => {
      await runWalletAction("Withdrawing claim", async () => {
        const hash = await writeContractAsync({
          address: publicEnv.poolAddress,
          abi: privaLendPoolAbi,
          functionName: "withdrawClaim",
          args: [loan.loanId],
          chainId: publicEnv.chainId,
        });
        await waitForReceipt(publicClient as PublicClient | undefined, hash);
        await refreshAll();
      }, setActionLabel, setLastError);
    },
    [publicClient, refreshAll, writeContractAsync],
  );

  const closePosition = useCallback(
    async (loan: PoolLoan) => {
      await runWalletAction("Closing position", async () => {
        const hash = await writeContractAsync({
          address: publicEnv.poolAddress,
          abi: privaLendPoolAbi,
          functionName: "closePosition",
          args: [loan.loanId],
          chainId: publicEnv.chainId,
        });
        await waitForReceipt(publicClient as PublicClient | undefined, hash);
        await refreshAll();
      }, setActionLabel, setLastError);
    },
    [publicClient, refreshAll, writeContractAsync],
  );

  const runDemoTick = useCallback(async () => {
    await runWalletAction("Running demo tick", async () => {
      await postDemoTick();
      await refreshAll();
    }, setActionLabel, setLastError);
  }, [refreshAll]);

  return {
    actionLabel,
    actionPending: actionLabel !== null,
    address,
    backendReachable,
    collateralToken,
    debtToken,
    encryptionMode: publicEnv.crePublicKey ? "ecies" : "plaintext-dev",
    isConnected,
    isCorrectChain,
    lastError,
    lastPollAt,
    loans,
    postedIntents,
    proposals: relevantProposals,
    role,
    approveCollateral,
    approveDebt,
    clearError: () => setLastError(null),
    closePosition,
    parseCollateralAmount: (value: string) => parseHumanAmount(value, collateralToken.decimals),
    parseDebtAmount: (value: string) => parseHumanAmount(value, debtToken.decimals),
    refreshAll,
    repay,
    runDemoTick,
    settleProposal,
    submitBorrow,
    submitLend,
    switchToDemoChain,
    withdrawClaim,
  };
}

export async function fetchProposalSettlementStates(publicClient: PublicClient, proposals: SignedProposal[]) {
  const entries = await Promise.all(
    proposals.map(async (proposal) => {
      const settled = (await publicClient.readContract({
        address: publicEnv.poolAddress,
        abi: privaLendPoolAbi,
        functionName: "consumedProposalHash",
        args: [proposal.proposalHash],
      })) as boolean;
      return [proposal.proposalId, settled] as const;
    }),
  );

  return Object.fromEntries(entries);
}

export async function fetchSignedPoolLoans(publicClient: PublicClient, address: Address, proposals: SignedProposal[]): Promise<PoolLoan[]> {
  const normalizedAddress = address.toLowerCase();
  const nextLoanId = (await publicClient.readContract({
    address: publicEnv.poolAddress,
    abi: privaLendPoolAbi,
    functionName: "nextLoanId",
  })) as bigint;

  const loanIds = Array.from({ length: Number(nextLoanId > 0n ? nextLoanId - 1n : 0n) }, (_, index) => BigInt(index + 1));
  const loans: Array<PoolLoan | null> = await Promise.all(
    loanIds.map(async (loanId) => {
      const loan = (await publicClient.readContract({
        address: publicEnv.poolAddress,
        abi: privaLendPoolAbi,
        functionName: "getLoan",
        args: [loanId],
      })) as PoolLoanTuple;

      if (loan.status === 0) return null;

      const lenders = (await publicClient.readContract({
        address: publicEnv.poolAddress,
        abi: privaLendPoolAbi,
        functionName: "getLoanLenders",
        args: [loanId],
      })) as Address[];

      const isBorrower = loan.borrower.toLowerCase() === normalizedAddress;
      const isLender = lenders.some((lender) => lender.toLowerCase() === normalizedAddress);
      if (!isBorrower && !isLender) return null;

      const [lenderPrincipal, lenderClaimable] = isLender
        ? await Promise.all([
            publicClient.readContract({
              address: publicEnv.poolAddress,
              abi: privaLendPoolAbi,
              functionName: "lenderPrincipalByLoan",
              args: [loanId, address],
            }) as Promise<bigint>,
            publicClient.readContract({
              address: publicEnv.poolAddress,
              abi: privaLendPoolAbi,
              functionName: "lenderClaimableByLoan",
              args: [loanId, address],
            }) as Promise<bigint>,
          ])
        : [0n, 0n];

      const matchedProposal = proposals.find(
        (proposal) => stringIdToBytes32(proposal.proposalId).toLowerCase() === loan.proposalIdHash.toLowerCase(),
      );

      const mappedLoan: PoolLoan = {
        borrower: loan.borrower,
        collateralAmount: loan.collateralAmount,
        collateralToken: loan.collateralToken,
        effectiveBorrowerRate: loan.effectiveBorrowerRate,
        lenderClaimable,
        lenderPrincipal,
        lenders,
        loanId,
        matchedProposal,
        outstandingPrincipal: loan.outstandingPrincipal,
        principal: loan.principal,
        proposalIdHash: loan.proposalIdHash,
        role: isBorrower && isLender ? "both" : isBorrower ? "borrower" : "lender",
        status: loan.status as PoolLoanStatus,
        token: loan.token,
      };

      return mappedLoan;
    }),
  );

  return loans.filter((loan): loan is PoolLoan => loan !== null);
}

function readTokenState({
  address,
  fallbackDecimals,
  fallbackSymbol,
  isLoading,
  results,
}: {
  address: Address;
  fallbackDecimals: number;
  fallbackSymbol: string;
  isLoading: boolean;
  results?: readonly { result?: unknown; status: "success" | "failure" }[];
}): TokenState {
  if (!results) return emptyToken(address, fallbackSymbol, fallbackDecimals);

  return {
    address,
    allowance: typeof results[3]?.result === "bigint" ? results[3].result : 0n,
    balance: typeof results[2]?.result === "bigint" ? results[2].result : 0n,
    decimals: typeof results[0]?.result === "number" ? results[0].result : fallbackDecimals,
    isLoading,
    symbol: typeof results[1]?.result === "string" ? results[1].result : fallbackSymbol,
  };
}

async function waitForReceipt(publicClient: PublicClient | undefined, hash: Hex) {
  if (!publicClient) return;
  await publicClient.waitForTransactionReceipt({ hash });
}

async function runWalletAction(
  label: string,
  action: () => Promise<void>,
  setActionLabel: (label: string | null) => void,
  setLastError: (message: string | null) => void,
) {
  setActionLabel(label);
  setLastError(null);
  try {
    await action();
  } catch (error) {
    setLastError(errorMessage(error));
    throw error;
  } finally {
    setActionLabel(null);
  }
}

function loadPostedIntents(address: Address): PostedIntent[] {
  try {
    const raw = window.localStorage.getItem(postedIntentKey(address));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PostedIntent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rememberPostedIntent(
  address: Address,
  intent: PostedIntent,
  setPostedIntents: (updater: (previous: PostedIntent[]) => PostedIntent[]) => void,
) {
  setPostedIntents((previous) => {
    const next = [intent, ...previous.filter((item) => item.intentId !== intent.intentId)].slice(0, 20);
    window.localStorage.setItem(postedIntentKey(address), JSON.stringify(next));
    return next;
  });
}

function postedIntentKey(address: Address) {
  return `privalend:posted-intents:${address.toLowerCase()}`;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Unexpected PrivaLend error";
}
