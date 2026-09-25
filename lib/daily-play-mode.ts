import {
  DEFAULT_STREAK_CAMPAIGN_ID,
} from "@/lib/arcadex-rewards";

export type DailyPlayMode = "streak" | "shuffle";

/**
 * Client / local fallback only. Production reads the Cloudflare Worker env
 * in `loadDailyPlayConfig` (`DAILY_PLAY_MODE` or `NEXT_PUBLIC_DAILY_PLAY_MODE`
 * set in the dashboard). Do not put those in wrangler.jsonc.
 */
export function getDailyPlayMode(): DailyPlayMode {
  const mode = (
    process.env.DAILY_PLAY_MODE?.trim() ||
    process.env.NEXT_PUBLIC_DAILY_PLAY_MODE?.trim() ||
    ""
  ).toLowerCase();
  return mode === "shuffle" ? "shuffle" : "streak";
}

export function isShuffleDailyPlay(): boolean {
  return getDailyPlayMode() === "shuffle";
}

export const DEFAULT_SHUFFLE_CAMPAIGN_ID = Number(
  process.env.SHUFFLE_CAMPAIGN_ID?.trim() ||
    process.env.NEXT_PUBLIC_SHUFFLE_CAMPAIGN_ID?.trim() ||
    "3"
);

/** Campaign used for today's daily sign-in ceremony. */
export function getDailyCampaignId(): number {
  return isShuffleDailyPlay()
    ? DEFAULT_SHUFFLE_CAMPAIGN_ID
    : DEFAULT_STREAK_CAMPAIGN_ID;
}

export type DailyPlayConfig = {
  mode: DailyPlayMode;
  campaignId: number;
  shuffle: boolean;
};
