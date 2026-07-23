import {
  DEFAULT_STREAK_CAMPAIGN_ID,
} from "@/lib/arcadex-rewards";

export type DailyPlayMode = "streak" | "shuffle";

/** Test toggle — keep streak code; switch back to `streak` for launch. */
export function getDailyPlayMode(): DailyPlayMode {
  const mode = process.env.NEXT_PUBLIC_DAILY_PLAY_MODE?.trim().toLowerCase();
  return mode === "shuffle" ? "shuffle" : "streak";
}

export function isShuffleDailyPlay(): boolean {
  return getDailyPlayMode() === "shuffle";
}

export const DEFAULT_SHUFFLE_CAMPAIGN_ID = Number(
  process.env.NEXT_PUBLIC_SHUFFLE_CAMPAIGN_ID?.trim() || "2"
);

/** Campaign used for today's daily sign-in ceremony. */
export function getDailyCampaignId(): number {
  return isShuffleDailyPlay()
    ? DEFAULT_SHUFFLE_CAMPAIGN_ID
    : DEFAULT_STREAK_CAMPAIGN_ID;
}
