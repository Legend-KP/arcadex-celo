/** ISO week helpers + sparks-first ranking for the global activity board. */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const ACTIVITY_PLAY_COOLDOWN_MS = 5_000;
export const ACTIVITY_LEADERBOARD_MAX_ENTRIES = 25;
export const ACTIVITY_TOP_MIRROR_SIZE = 50;

export type ActivityEventKind =
  | "play"
  | "visit"
  | "tx"
  | "spend";

export interface ActivityWeekWindow {
  weekId: string;
  startsAt: number;
  endsAt: number;
}

export interface ActivityCounters {
  sparksSpent: number;
  activeDays: number;
  txs: number;
  spendUnits: number;
  lastActiveDay?: string;
  lastPlayAt?: number;
  updatedAt?: number;
  name?: string;
}

export interface ActivityLeaderboardEntry {
  name: string;
  /** Display score = sparks spent this week. */
  score: number;
  walletAddress: string;
  activeDays?: number;
  txs?: number;
  spendUnits?: number;
  updatedAt?: number;
}

/** Monday 00:00 UTC of the ISO week containing `now`. */
export function getIsoWeekWindow(now = Date.now()): ActivityWeekWindow {
  const d = new Date(now);
  const utc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const day = new Date(utc).getUTCDay(); // 0 Sun … 6 Sat
  const daysFromMonday = (day + 6) % 7;
  const startsAt = utc - daysFromMonday * MS_PER_DAY;
  const endsAt = startsAt + 7 * MS_PER_DAY;
  return {
    weekId: isoWeekIdFromMondayUtc(startsAt),
    startsAt,
    endsAt,
  };
}

export function getPreviousIsoWeekWindow(now = Date.now()): ActivityWeekWindow {
  const current = getIsoWeekWindow(now);
  return getIsoWeekWindow(current.startsAt - 1);
}

function isoWeekIdFromMondayUtc(mondayUtcMs: number): string {
  const monday = new Date(mondayUtcMs);
  // ISO week year is the year of the Thursday of this week.
  const thursday = new Date(mondayUtcMs + 3 * MS_PER_DAY);
  const weekYear = thursday.getUTCFullYear();
  const jan4 = Date.UTC(weekYear, 0, 4);
  const jan4Day = new Date(jan4).getUTCDay();
  const jan4Monday = jan4 - ((jan4Day + 6) % 7) * MS_PER_DAY;
  const week = Math.floor((mondayUtcMs - jan4Monday) / (7 * MS_PER_DAY)) + 1;
  return `${weekYear}-W${String(week).padStart(2, "0")}`;
}

export function utcDayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function emptyActivityCounters(): ActivityCounters {
  return {
    sparksSpent: 0,
    activeDays: 0,
    txs: 0,
    spendUnits: 0,
  };
}

export function coerceActivityCounters(raw: unknown): ActivityCounters {
  const base = emptyActivityCounters();
  if (!raw || typeof raw !== "object") return base;
  const data = raw as Partial<ActivityCounters>;
  return {
    sparksSpent:
      typeof data.sparksSpent === "number" && Number.isFinite(data.sparksSpent)
        ? Math.max(0, Math.floor(data.sparksSpent))
        : 0,
    activeDays:
      typeof data.activeDays === "number" && Number.isFinite(data.activeDays)
        ? Math.max(0, Math.floor(data.activeDays))
        : 0,
    txs:
      typeof data.txs === "number" && Number.isFinite(data.txs)
        ? Math.max(0, Math.floor(data.txs))
        : 0,
    spendUnits:
      typeof data.spendUnits === "number" && Number.isFinite(data.spendUnits)
        ? Math.max(0, Math.floor(data.spendUnits))
        : 0,
    lastActiveDay:
      typeof data.lastActiveDay === "string" ? data.lastActiveDay : undefined,
    lastPlayAt:
      typeof data.lastPlayAt === "number" && Number.isFinite(data.lastPlayAt)
        ? data.lastPlayAt
        : undefined,
    updatedAt:
      typeof data.updatedAt === "number" && Number.isFinite(data.updatedAt)
        ? data.updatedAt
        : undefined,
    name: typeof data.name === "string" ? data.name : undefined,
  };
}

/** Sparks spent first; then activeDays, txs, spendUnits; then earlier updatedAt. */
export function compareActivityEntries(
  a: ActivityLeaderboardEntry,
  b: ActivityLeaderboardEntry
): number {
  if (b.score !== a.score) return b.score - a.score;
  const aDays = a.activeDays ?? 0;
  const bDays = b.activeDays ?? 0;
  if (bDays !== aDays) return bDays - aDays;
  const aTxs = a.txs ?? 0;
  const bTxs = b.txs ?? 0;
  if (bTxs !== aTxs) return bTxs - aTxs;
  const aSpend = a.spendUnits ?? 0;
  const bSpend = b.spendUnits ?? 0;
  if (bSpend !== aSpend) return bSpend - aSpend;
  const aUpdated = a.updatedAt ?? Number.MAX_SAFE_INTEGER;
  const bUpdated = b.updatedAt ?? Number.MAX_SAFE_INTEGER;
  if (aUpdated !== bUpdated) return aUpdated - bUpdated;
  return (a.walletAddress || "").localeCompare(b.walletAddress || "");
}

export function formatActivityCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`;
  }
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}
