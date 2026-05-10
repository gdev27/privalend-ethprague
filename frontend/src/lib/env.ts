import { getAddress, isAddress, type Address } from "viem";
import { sepolia } from "wagmi/chains";

const rawEnv = {
  backendUrl: process.env.NEXT_PUBLIC_BACKEND_URL,
  chainId: process.env.NEXT_PUBLIC_CHAIN_ID,
  collateralTokenAddress: process.env.NEXT_PUBLIC_COLLATERAL_TOKEN_ADDRESS,
  crePublicKey: process.env.NEXT_PUBLIC_CRE_PUBKEY,
  debtTokenAddress: process.env.NEXT_PUBLIC_DEBT_TOKEN_ADDRESS,
  demoTickEnabled: process.env.NEXT_PUBLIC_DEMO_TICK_ENABLED,
  kmsAddress: process.env.NEXT_PUBLIC_KMS_ADDRESS,
  liquidationLtvPercent: process.env.NEXT_PUBLIC_LIQUIDATION_LTV_PERCENT,
  networkName: process.env.NEXT_PUBLIC_NETWORK_NAME,
  poolAddress: process.env.NEXT_PUBLIC_POOL_ADDRESS,
  sepoliaRpcUrl: process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL,
  walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
  wethReferencePriceUsd: process.env.NEXT_PUBLIC_WETH_REFERENCE_PRICE_USD,
};

const defaults = {
  backendUrl: "http://localhost:3000",
  chainId: String(sepolia.id),
  collateralTokenAddress: "0x8564748c702A363EA620FFa7040cC1829f9d50Fb",
  debtTokenAddress: "0x53C0327F3Fb815c237dbb30bEE5c8210f6843F9F",
  kmsAddress: "0xbD7C5746F9E7783cd4AcDEeE700D195FEB9eE730",
  liquidationLtvPercent: "90",
  networkName: "Sepolia",
  poolAddress: "0xa42a37ed07719e39ae57b300146bc74462bcfa39",
  sepoliaRpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
  walletConnectProjectId: "4c8732f195345771b68e014eae9df31c",
  wethReferencePriceUsd: "2328.595",
} as const;

function publicString(value: string | undefined, fallback: string, name: string) {
  const resolved = value?.trim() || fallback;
  if (!resolved) throw new Error(`Missing public env value: ${name}`);
  return resolved;
}

function publicAddress(value: string | undefined, fallback: string, name: string): Address {
  const resolved = publicString(value, fallback, name);
  if (!isAddress(resolved)) throw new Error(`Invalid address for ${name}`);
  return getAddress(resolved);
}

function publicNumber(value: string | undefined, fallback: string, name: string) {
  const resolved = Number(publicString(value, fallback, name));
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new Error(`Invalid number for ${name}`);
  }
  return resolved;
}

function publicChainId(value: string | undefined) {
  const resolved = publicNumber(value, defaults.chainId, "NEXT_PUBLIC_CHAIN_ID");
  if (resolved !== sepolia.id) {
    throw new Error(`PrivaLend demo requires Sepolia chainId ${sepolia.id}`);
  }
  return resolved;
}

function stripTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function optionalHex(value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  const withoutPrefix = normalized.startsWith("0x") || normalized.startsWith("0X") ? normalized.slice(2) : normalized;
  if (!/^[0-9a-fA-F]+$/.test(withoutPrefix) || withoutPrefix.length % 2 !== 0) {
    throw new Error("Invalid NEXT_PUBLIC_CRE_PUBKEY hex value");
  }
  return withoutPrefix;
}

export const publicEnv = {
  backendUrl: stripTrailingSlash(publicString(rawEnv.backendUrl, defaults.backendUrl, "NEXT_PUBLIC_BACKEND_URL")),
  chainId: publicChainId(rawEnv.chainId),
  collateralTokenAddress: publicAddress(rawEnv.collateralTokenAddress, defaults.collateralTokenAddress, "NEXT_PUBLIC_COLLATERAL_TOKEN_ADDRESS"),
  crePublicKey: optionalHex(rawEnv.crePublicKey),
  debtTokenAddress: publicAddress(rawEnv.debtTokenAddress, defaults.debtTokenAddress, "NEXT_PUBLIC_DEBT_TOKEN_ADDRESS"),
  demoTickEnabled: rawEnv.demoTickEnabled === "true",
  kmsAddress: publicAddress(rawEnv.kmsAddress, defaults.kmsAddress, "NEXT_PUBLIC_KMS_ADDRESS"),
  liquidationLtvPercent: publicNumber(rawEnv.liquidationLtvPercent, defaults.liquidationLtvPercent, "NEXT_PUBLIC_LIQUIDATION_LTV_PERCENT"),
  networkName: publicString(rawEnv.networkName, defaults.networkName, "NEXT_PUBLIC_NETWORK_NAME"),
  poolAddress: publicAddress(rawEnv.poolAddress, defaults.poolAddress, "NEXT_PUBLIC_POOL_ADDRESS"),
  sepoliaRpcUrl: publicString(rawEnv.sepoliaRpcUrl, defaults.sepoliaRpcUrl, "NEXT_PUBLIC_SEPOLIA_RPC_URL"),
  walletConnectProjectId: publicString(rawEnv.walletConnectProjectId, defaults.walletConnectProjectId, "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID"),
  wethReferencePriceUsd: publicNumber(rawEnv.wethReferencePriceUsd, defaults.wethReferencePriceUsd, "NEXT_PUBLIC_WETH_REFERENCE_PRICE_USD"),
} as const;

export type PublicEnv = typeof publicEnv;
