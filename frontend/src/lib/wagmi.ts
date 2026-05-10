import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  injectedWallet,
  metaMaskWallet,
  rainbowWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { sepolia } from "wagmi/chains";
import { publicEnv } from "./env";

const appName = "PrivaLend";
const chains = [sepolia] as const;

const connectors = connectorsForWallets(
  [
    {
      groupName: "Popular",
      wallets: [rainbowWallet, metaMaskWallet, walletConnectWallet, injectedWallet],
    },
  ],
  {
    appName,
    projectId: publicEnv.walletConnectProjectId,
  },
);

export const wagmiConfig = createConfig({
  chains,
  connectors,
  ssr: true,
  transports: {
    [sepolia.id]: http(publicEnv.sepoliaRpcUrl),
  },
});
