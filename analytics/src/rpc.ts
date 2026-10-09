import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";
import type { Env } from "./env";
import { getRpcUrl } from "./env";

const FALLBACK_RPCS = [
  "https://forno.celo.org",
  "https://rpc.ankr.com/celo",
  "https://1rpc.io/celo",
] as const;

export function createCeloClient(env: Env) {
  const primary = getRpcUrl(env);
  const urls = [primary, ...FALLBACK_RPCS.filter((u) => u !== primary)];
  return createPublicClient({
    chain: celo,
    transport: http(urls[0], { timeout: 30_000 }),
  });
}

export type CeloClient = ReturnType<typeof createCeloClient>;

/** Block range per eth_getLogs call (Forno max is 5000). */
export const LOG_CHUNK_BLOCKS = 5_000n;

/** Wall-clock budget per sync / cron invocation. */
export const SYNC_TIME_BUDGET_MS = 25_000;
