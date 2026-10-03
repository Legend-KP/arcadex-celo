/**
 * Daily XP Board — UTC-day XP, eligibility, and campaign 6 claim constants.
 * Transition ends Saturday 3 Oct 2026 00:00 UTC, then live board + Claim.
 */

import { utcDayKey } from "@/lib/activity-week";

/** Saturday 3 Oct 2026 00:00:00.000 UTC */
export const DAILY_XP_GO_LIVE_AT_MS = Date.UTC(2026, 9, 3, 0, 0, 0, 0);

export const DAILY_XP_THRESHOLD = 100;
export const DAILY_XP_REWARD_USDT = 0.05;
/** On-chain amount (USDT, 6 decimals). */
export const DAILY_XP_REWARD_AMOUNT = BigInt(50_000);

export const DAILY_XP_PER_PLAY = 10;
export const DAILY_XP_PER_CHECK_IN = 10;
export const DAILY_XP_PER_SPEND_UNIT = 10;

/** Max board rows returned to clients. */
export const DAILY_XP_LEADERBOARD_MAX_ENTRIES = 50;

/**
 * Reuse the weekly play cooldown so Infinite holders cannot script
 * opens faster than once per 30s for daily XP.
 */
export { ACTIVITY_PLAY_COOLDOWN_MS as DAILY_XP_PLAY_COOLDOWN_MS } from "@/lib/activity-week";

export const DAILY_XP_CAMPAIGN_ID = Number(
  process.env.DAILY_XP_CAMPAIGN_ID?.trim() ||
    process.env.NEXT_PUBLIC_DAILY_XP_CAMPAIGN_ID?.trim() ||
    "6"
);

export type DailyXpEventKind = "play" | "check_in" | "spend";

export interface DailyXpCounters {
  plays: number;
  checkedIn: boolean;
  spendUnits: number;
  lastPlayAt?: number;
  updatedAt?: number;
  name?: string;
}

export interface DailyXpLeaderboardEntry {
  name: string;
  score: number;
  walletAddress: string;
  plays?: number;
  checkedIn?: boolean;
  spendUnits?: number;
  updatedAt?: number;
}

export interface DailyXpDayWindow {
  dayKey: string;
  startsAt: number;
  endsAt: number;
}

export function isDailyXpTransition(now = Date.now()): boolean {
  return now < DAILY_XP_GO_LIVE_AT_MS;
}

export function isDailyXpLive(now = Date.now()): boolean {
  return now >= DAILY_XP_GO_LIVE_AT_MS;
}

/** `HH:MM:SS` countdown (hours may exceed 24). */
export function formatDailyXpStartsIn(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatDailyXpCountdown(remainingMs: number): string {
  return formatDailyXpStartsIn(remainingMs);
}

export function getUtcDayWindow(now = Date.now()): DailyXpDayWindow {
  const dayKey = utcDayKey(now);
  const startsAt = Date.parse(`${dayKey}T00:00:00.000Z`);
  const endsAt = startsAt + 24 * 60 * 60 * 1000;
  return { dayKey, startsAt, endsAt };
}

export function emptyDailyXpCounters(): DailyXpCounters {
  return {
    plays: 0,
    checkedIn: false,
    spendUnits: 0,
  };
}

export function coerceDailyXpCounters(raw: unknown): DailyXpCounters {
  const base = emptyDailyXpCounters();
  if (!raw || typeof raw !== "object") return base;
  const data = raw as Partial<DailyXpCounters> & {
    checked_in?: boolean | number;
    spend_units?: number;
    last_play_at?: number;
    updated_at?: number;
  };
  return {
    plays:
      typeof data.plays === "number" && Number.isFinite(data.plays)
        ? Math.max(0, Math.floor(data.plays))
        : 0,
    checkedIn: Boolean(data.checkedIn ?? data.checked_in),
    spendUnits:
      typeof data.spendUnits === "number" && Number.isFinite(data.spendUnits)
        ? Math.max(0, Math.floor(data.spendUnits))
        : typeof data.spend_units === "number" &&
            Number.isFinite(data.spend_units)
          ? Math.max(0, Math.floor(data.spend_units))
          : 0,
    lastPlayAt:
      typeof data.lastPlayAt === "number" && Number.isFinite(data.lastPlayAt)
        ? data.lastPlayAt
        : typeof data.last_play_at === "number" &&
            Number.isFinite(data.last_play_at)
          ? data.last_play_at
          : undefined,
    updatedAt:
      typeof data.updatedAt === "number" && Number.isFinite(data.updatedAt)
        ? data.updatedAt
        : typeof data.updated_at === "number" && Number.isFinite(data.updated_at)
          ? data.updated_at
          : undefined,
    name: typeof data.name === "string" ? data.name : undefined,
  };
}

/**
 * Daily board XP — no active-day, no streak-ladder, no Tx Hub.
 * XP = (opens × 10) + (check-in × 10) + (spend units × 10)
 */
export function computeDailyXp(
  counters: Pick<DailyXpCounters, "plays" | "checkedIn" | "spendUnits">
): number {
  return (
    Math.max(0, counters.plays) * DAILY_XP_PER_PLAY +
    (counters.checkedIn ? DAILY_XP_PER_CHECK_IN : 0) +
    Math.max(0, counters.spendUnits) * DAILY_XP_PER_SPEND_UNIT
  );
}

export function dailyXpEntryFromCounters(
  wallet: string,
  counters: DailyXpCounters
): DailyXpLeaderboardEntry {
  return {
    name: counters.name?.trim() || "Player",
    score: computeDailyXp(counters),
    walletAddress: wallet,
    plays: counters.plays,
    checkedIn: counters.checkedIn,
    spendUnits: counters.spendUnits,
    updatedAt: counters.updatedAt,
  };
}

export function compareDailyXpEntries(
  a: DailyXpLeaderboardEntry,
  b: DailyXpLeaderboardEntry
): number {
  if (b.score !== a.score) return b.score - a.score;
  const aUpdated = a.updatedAt ?? Number.MAX_SAFE_INTEGER;
  const bUpdated = b.updatedAt ?? Number.MAX_SAFE_INTEGER;
  return aUpdated - bUpdated;
}

export function findDailyXpRank(
  entries: DailyXpLeaderboardEntry[],
  walletAddress: string
): number | null {
  const wallet = walletAddress.toLowerCase();
  const idx = entries.findIndex(
    (e) => e.walletAddress.toLowerCase() === wallet
  );
  return idx >= 0 ? idx + 1 : null;
}

export function isDailyXpEligible(opts: {
  xp: number;
  checkedIn: boolean;
  claimed: boolean;
  banned?: boolean;
}): boolean {
  return (
    !opts.banned &&
    !opts.claimed &&
    opts.checkedIn &&
    opts.xp >= DAILY_XP_THRESHOLD
  );
}

export type DailyXpClaimRecord = {
  wallet: string;
  utcDay: string;
  status: "pending" | "claimed" | "forfeited";
  campaignId: number;
  nonce?: number;
  rewardAmount?: string;
  signature?: string;
  deadline?: number;
  txHash?: string;
  createdAt: number;
  claimedAt?: number;
};
