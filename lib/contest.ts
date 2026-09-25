import {
  CONTEST_DURATION_OPTIONS,
  ContestDurationDays,
  ContestInfo,
  ContestStatus,
  Game,
  LeaderboardEntry,
} from "@/types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

export function isContestDurationDays(
  value: unknown
): value is ContestDurationDays {
  return (
    typeof value === "number" &&
    (CONTEST_DURATION_OPTIONS as readonly number[]).includes(value)
  );
}

export function computeContestEndsAt(
  startedAt: number,
  durationDays: number
): number {
  return startedAt + durationDays * MS_PER_DAY;
}

/** Days (possibly fractional) between start and end. */
export function durationDaysFromRange(startedAt: number, endsAt: number): number {
  const ms = Math.max(0, endsAt - startedAt);
  const days = ms / MS_PER_DAY;
  // Keep one decimal for custom lengths (e.g. 12h → 0.5).
  return Math.max(Math.round(days * 10) / 10, ms > 0 ? 0.1 : 0);
}

export function getContestStatus(
  game: Pick<Game, "contestStartedAt" | "contestEndsAt">,
  now = Date.now()
): ContestStatus | null {
  const startedAt = game.contestStartedAt;
  const endsAt = game.contestEndsAt;
  if (
    typeof startedAt !== "number" ||
    typeof endsAt !== "number" ||
    !Number.isFinite(startedAt) ||
    !Number.isFinite(endsAt)
  ) {
    return null;
  }
  return endsAt > now ? "live" : "ended";
}

export function isContestActive(
  game: Pick<Game, "contestStartedAt" | "contestEndsAt">,
  now = Date.now()
): boolean {
  return getContestStatus(game, now) === "live";
}

export function formatContestCountdown(remainingMs: number): string {
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

/** Local `YYYY-MM-DDTHH:mm` for `<input type="datetime-local">`. */
export function toDatetimeLocalValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function parseDatetimeLocalValue(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ms = new Date(trimmed).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function buildContestInfo(
  game: Pick<
    Game,
    | "contestTask"
    | "contestStartedAt"
    | "contestEndsAt"
    | "contestDurationDays"
  >,
  entries: LeaderboardEntry[],
  now = Date.now()
): ContestInfo | null {
  const status = getContestStatus(game, now);
  const startedAt = game.contestStartedAt;
  const endsAt = game.contestEndsAt;
  if (!status || typeof startedAt !== "number" || typeof endsAt !== "number") {
    return null;
  }

  const durationDays =
    typeof game.contestDurationDays === "number" &&
    Number.isFinite(game.contestDurationDays) &&
    game.contestDurationDays > 0
      ? game.contestDurationDays
      : durationDaysFromRange(startedAt, endsAt);

  return {
    status,
    task: game.contestTask?.trim() ?? "",
    startedAt,
    endsAt,
    durationDays,
    entries,
  };
}

export { MS_PER_DAY, MS_PER_HOUR };
