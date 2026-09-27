import { getIsoWeekWindow } from "@/lib/activity-week";
import { isContestActive } from "@/lib/contest";
import {
  getPromoRemainingSlotsToday,
  isPromoEventRead,
  wasPromoShownToday,
} from "@/lib/promo-popups-seen";
import {
  Game,
  gameIsLive,
  gameIsNewArrival,
  gameIsTest,
} from "@/types";

export const PROMO_MILESTONES_HOURS = [12, 6, 3, 1] as const;
export type ContestPromoMilestoneHours = (typeof PROMO_MILESTONES_HOURS)[number];

/** Extra XP-board ending pings so the weekly board surfaces more often. */
export const WEEK_PROMO_MILESTONES_HOURS = [48, 24, 12, 6, 3, 1] as const;
export type WeekPromoMilestoneHours = (typeof WEEK_PROMO_MILESTONES_HOURS)[number];

export type PromoMilestoneHours =
  | ContestPromoMilestoneHours
  | WeekPromoMilestoneHours;

/** New-week XP nudge through the first 3 days of the ISO week (was 24h). */
const NEW_WEEK_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export type PromoPopupKind =
  | "contestEnd"
  | "contestStart"
  | "weekEnd"
  | "weekStart"
  | "newGame"
  | "communityTelegram"
  | "communityX";

export interface PromoPopupCandidate {
  id: string;
  kind: PromoPopupKind;
  /** Lower = higher priority. */
  priority: number;
  gameId?: string;
  gameName?: string;
  contestTask?: string;
  endsAt?: number;
  milestoneHours?: PromoMilestoneHours;
  weekId?: string;
  /** Permanent dismiss on X/CTA (false for community). */
  persistent: boolean;
}

function milestoneForRemaining(
  remainingMs: number,
  milestones: readonly number[]
): number | null {
  if (remainingMs <= 0) return null;
  const hours = remainingMs / (60 * 60 * 1000);
  for (const m of [...milestones].sort((a, b) => a - b)) {
    if (hours <= m) return m;
  }
  return null;
}

function contestEndPriority(hours: ContestPromoMilestoneHours): number {
  switch (hours) {
    case 1:
      return 10;
    case 3:
      return 20;
    case 6:
      return 30;
    case 12:
      return 40;
  }
}

function weekEndPriority(hours: WeekPromoMilestoneHours): number {
  switch (hours) {
    case 1:
      return 50;
    case 3:
      return 55;
    case 6:
      return 60;
    case 12:
      return 65;
    case 24:
      return 70;
    case 48:
      return 75;
  }
}

/** Drop the fees/rewards boilerplate from admin contest task for promo copy. */
export function sanitizeContestTaskForPromo(task?: string): string | undefined {
  if (!task?.trim()) return undefined;
  const cleaned = task
    .replace(/\s*100%\s*of\s*the\s*Fees[^.!?\n]*/gi, "")
    .replace(/\s*generated\s+goes\s+into\s+the\s+Rewards!?/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.!?])/g, "$1")
    .trim();
  return cleaned || undefined;
}

function buildGameCandidates(games: Game[], now: number): PromoPopupCandidate[] {
  const out: PromoPopupCandidate[] = [];

  for (const game of games) {
    if (!game.active || gameIsTest(game) || !gameIsLive(game)) continue;

    if (
      typeof game.newArrivalAt === "number" &&
      Number.isFinite(game.newArrivalAt) &&
      game.newArrivalAt > 0 &&
      gameIsNewArrival(game, now)
    ) {
      out.push({
        id: `newGame:${game.id}:${game.newArrivalAt}`,
        kind: "newGame",
        priority: 200,
        gameId: game.id,
        gameName: game.name,
        persistent: true,
      });
    }

    if (!isContestActive(game, now)) continue;

    const startedAt = game.contestStartedAt!;
    const endsAt = game.contestEndsAt!;
    const contestTask = sanitizeContestTaskForPromo(game.contestTask);

    out.push({
      id: `contestStart:${game.id}:${startedAt}`,
      kind: "contestStart",
      priority: 100,
      gameId: game.id,
      gameName: game.name,
      contestTask,
      endsAt,
      persistent: true,
    });

    const milestone = milestoneForRemaining(
      endsAt - now,
      PROMO_MILESTONES_HOURS
    ) as ContestPromoMilestoneHours | null;
    if (milestone != null) {
      out.push({
        id: `contestEnd:${game.id}:${endsAt}:${milestone}`,
        kind: "contestEnd",
        priority: contestEndPriority(milestone),
        gameId: game.id,
        gameName: game.name,
        contestTask,
        endsAt,
        milestoneHours: milestone,
        persistent: true,
      });
    }
  }

  return out;
}

function buildWeekCandidates(now: number): PromoPopupCandidate[] {
  const week = getIsoWeekWindow(now);
  const out: PromoPopupCandidate[] = [];

  if (now - week.startsAt < NEW_WEEK_WINDOW_MS) {
    out.push({
      id: `weekStart:${week.weekId}`,
      kind: "weekStart",
      priority: 150,
      weekId: week.weekId,
      endsAt: week.endsAt,
      persistent: true,
    });
  }

  const milestone = milestoneForRemaining(
    week.endsAt - now,
    WEEK_PROMO_MILESTONES_HOURS
  ) as WeekPromoMilestoneHours | null;
  if (milestone != null) {
    out.push({
      id: `weekEnd:${week.weekId}:${milestone}`,
      kind: "weekEnd",
      priority: weekEndPriority(milestone),
      weekId: week.weekId,
      endsAt: week.endsAt,
      milestoneHours: milestone,
      persistent: true,
    });
  }

  return out;
}

function buildCommunityCandidates(): PromoPopupCandidate[] {
  return [
    {
      id: "communityTelegram",
      kind: "communityTelegram",
      priority: 300,
      persistent: false,
    },
    {
      id: "communityX",
      kind: "communityX",
      priority: 310,
      persistent: false,
    },
  ];
}

/**
 * Eligible promos for this moment, sorted by priority (highest first).
 * Host shows at most one per app open; daily cap still limits how many
 * opens in a UTC day can surface a promo (max 3).
 */
export function buildPromoQueue(
  games: Game[],
  now = Date.now()
): PromoPopupCandidate[] {
  const remainingSlots = getPromoRemainingSlotsToday(now);
  if (remainingSlots <= 0) return [];

  const raw: PromoPopupCandidate[] = [
    ...buildGameCandidates(games, now),
    ...buildWeekCandidates(now),
    ...buildCommunityCandidates(),
  ];

  const eligible = raw.filter((item) => {
    if (wasPromoShownToday(item.id, now)) return false;
    if (item.persistent && isPromoEventRead(item.id)) return false;
    return true;
  });

  eligible.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.id.localeCompare(b.id);
  });

  return eligible.slice(0, remainingSlots);
}

export function getPromoTitle(item: PromoPopupCandidate): string {
  switch (item.kind) {
    case "newGame":
      return "New Arrival";
    case "contestStart":
      return "New Contest";
    case "contestEnd":
      return "Contest Ending Soon";
    case "weekStart":
      return "New Week on the Board";
    case "weekEnd":
      return "Leaderboard Ending Soon";
    case "communityTelegram":
      return "Join Telegram";
    case "communityX":
      return "Follow on X";
  }
}

export function getPromoBody(item: PromoPopupCandidate): string {
  switch (item.kind) {
    case "newGame":
      return item.gameName
        ? `${item.gameName} is live on ArcadeX. Jump in and try it out.`
        : "A new game is live on ArcadeX. Jump in and try it out.";
    case "contestStart":
      return [
        item.gameName ? `Contest is live on ${item.gameName}.` : "A new contest is live.",
        item.contestTask,
      ]
        .filter(Boolean)
        .join(" ");
    case "contestEnd":
      return [
        item.gameName
          ? `${item.gameName} contest is almost over.`
          : "A contest is almost over.",
        item.contestTask,
        "Play now to climb the board.",
      ]
        .filter(Boolean)
        .join(" ");
    case "weekStart":
      return "A new weekly leaderboard just started. Play on ArcadeX and climb the board.";
    case "weekEnd":
      return "This week's leaderboard is almost over. Act fast and climb the board on ArcadeX.";
    case "communityTelegram":
      return "Join the Telegram community to stay up to date on the latest ArcadeX news.";
    case "communityX":
      return "Follow ArcadeX on X for the latest updates and drops.";
  }
}

export function getPromoCtaLabel(item: PromoPopupCandidate): string {
  switch (item.kind) {
    case "newGame":
      return "Try it out";
    case "contestStart":
    case "contestEnd":
      return "Let's Go";
    case "weekStart":
    case "weekEnd":
      return "Let's Play";
    case "communityTelegram":
      return "Join now";
    case "communityX":
      return "Follow now";
  }
}

export function isCommunityPromo(kind: PromoPopupKind): boolean {
  return kind === "communityTelegram" || kind === "communityX";
}

export function isContestPromo(kind: PromoPopupKind): boolean {
  return kind === "contestStart" || kind === "contestEnd";
}

export function isLeaderboardPromo(kind: PromoPopupKind): boolean {
  return kind === "weekStart" || kind === "weekEnd";
}
