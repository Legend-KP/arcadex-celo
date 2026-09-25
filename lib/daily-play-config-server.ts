import type { DailyPlayConfig, DailyPlayMode } from "@/lib/daily-play-mode";
import { getWorkerContext } from "@/lib/worker-context";

function readString(
  source: Record<string, unknown> | NodeJS.ProcessEnv | null | undefined,
  key: string
): string {
  if (!source) return "";
  const value = source[key];
  return typeof value === "string" ? value.trim() : "";
}

function readPositiveInt(raw: string, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

/**
 * Dashboard / Worker env first. Bracket access so Next does not inline
 * NEXT_PUBLIC_* at build time from wrangler or .dev.vars.
 * process.env is only the local `next dev` fallback.
 */
export async function loadDailyPlayConfig(): Promise<DailyPlayConfig> {
  const cloudflare = (await getWorkerContext())?.env ?? null;

  const modeRaw = (
    readString(cloudflare, "DAILY_PLAY_MODE") ||
    readString(cloudflare, "NEXT_PUBLIC_DAILY_PLAY_MODE") ||
    readString(process.env, "DAILY_PLAY_MODE") ||
    readString(process.env, "NEXT_PUBLIC_DAILY_PLAY_MODE")
  ).toLowerCase();
  const mode: DailyPlayMode = modeRaw === "shuffle" ? "shuffle" : "streak";

  const campaignRaw =
    mode === "shuffle"
      ? readString(cloudflare, "SHUFFLE_CAMPAIGN_ID") ||
        readString(cloudflare, "NEXT_PUBLIC_SHUFFLE_CAMPAIGN_ID") ||
        readString(process.env, "SHUFFLE_CAMPAIGN_ID") ||
        readString(process.env, "NEXT_PUBLIC_SHUFFLE_CAMPAIGN_ID") ||
        "3"
      : readString(cloudflare, "STREAK_CAMPAIGN_ID") ||
        readString(cloudflare, "NEXT_PUBLIC_STREAK_CAMPAIGN_ID") ||
        readString(process.env, "NEXT_PUBLIC_STREAK_CAMPAIGN_ID") ||
        "1";

  return {
    mode,
    campaignId: readPositiveInt(campaignRaw, mode === "shuffle" ? 3 : 1),
    shuffle: mode === "shuffle",
  };
}
