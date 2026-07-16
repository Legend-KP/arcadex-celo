import { getGameCacheStats } from "@/lib/game-cache";

export type ApiMetricEvent = {
  endpoint: string;
  method?: string;
  status?: number;
  durationMs?: number;
  firestoreReads?: number;
  cacheHit?: boolean;
  cacheLayer?: "list" | "doc" | "http" | "progress_debounce";
  rateLimited?: boolean;
  wallet?: string;
  gameId?: string;
};

export function recordApiMetric(event: ApiMetricEvent): void {
  const payload = {
    type: "arcadex_api_metric",
    ts: Date.now(),
    cache: getGameCacheStats(),
    ...event,
  };

  console.log(JSON.stringify(payload));
}
