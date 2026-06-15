import { injected } from "@wagmi/core";
import { createConfig, http } from "wagmi";
import { celo } from "viem/chains";

export const wagmiConfig = createConfig({
  chains: [celo],
  connectors: [injected()],
  transports: {
    [celo.id]: http(),
  },
  ssr: true,
});
