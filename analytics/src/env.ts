export interface Env {
  ANALYTICS_DB: D1Database;
  CELO_RPC_URL?: string;
  ANALYTICS_SYNC_SECRET?: string;
  /** Optional override for first sync cursor (skips earlier empty history). */
  ANALYTICS_START_BLOCK?: string;
}

export function getRpcUrl(env: Env): string {
  const url = env.CELO_RPC_URL?.trim();
  return url && url.length > 0 ? url : "https://forno.celo.org";
}
