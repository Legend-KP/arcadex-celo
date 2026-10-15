import { createPublicClient, fallback, http } from "viem";
import { celo } from "viem/chains";
import type { Env } from "./env";
import { getRpcUrl } from "./env";

const FALLBACK_RPCS = [
  "https://forno.celo.org",
  "https://rpc.ankr.com/celo",
  "https://1rpc.io/celo",
  "https://celo.drpc.org",
] as const;

export function createCeloClient(env: Env) {
  const primary = getRpcUrl(env);
  const urls = [primary, ...FALLBACK_RPCS.filter((u) => u !== primary)];
  return createPublicClient({
    chain: celo,
    transport: fallback(
      urls.map((url) =>
        http(url, {
          timeout: 30_000,
          retryCount: 2,
          retryDelay: 800,
        })
      ),
      { rank: false }
    ),
  });
}

export type CeloClient = ReturnType<typeof createCeloClient>;

/**
 * Block range per eth_getLogs call.
 * Keep small: public Celo RPCs silently truncate large results, which
 * undercounts busy days vs Dune.
 */
export const LOG_CHUNK_BLOCKS = 500n;

/** Wall-clock budget per sync / cron invocation. */
export const SYNC_TIME_BUDGET_MS = 45_000;

/** Tip sync: only walk this many recent blocks each invocation. */
export const TIP_SYNC_MAX_BLOCKS = 10_000n;
