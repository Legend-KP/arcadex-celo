import { utcDayKey } from "@/lib/activity-week";
import { isContestActive } from "@/lib/contest";
import {
  DAILY_XP_REWARD_USDT,
  DAILY_XP_THRESHOLD,
  getUtcDayWindow,
  isDailyXpLive,
} from "@/lib/daily-xp-board";
import {
  getPromoRemainingSlotsToday,
  isPromoEventRead,
  wasPromoShownToday,
} from "@/lib/promo-popups-seen";
import { SPARK_MAX } from "@/lib/spark";
import {
  Game,
  gameIsLive,
  gameIsNewArrival,
  gameIsTest,
} from "@/types";

export const PROMO_MILESTONES_HOURS = [12, 6, 3, 1] as const;
export type ContestPromoMilestoneHours = (typeof PROMO_MILESTONES_HOURS)[number];

export type PromoMilestoneHours = ContestPromoMilestoneHours;

/** Sparks-cap announcement window (UTC). Shown once per user while active. */
export const SPARKS_UPGRADE_PROMO_START_MS = Date.UTC(2026, 8, 30);
export const SPARKS_UPGRADE_PROMO_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
export const SPARKS_UPGRADE_PROMO_ID = `sparksUpgrade:${SPARK_MAX}`;

export type PromoPopupKind =
  | "contestEnd"
  | "contestStart"
  | "dailyXp"
  | "newGame"
  | "communityTelegram"
  | "communityX"
  | "sparksUpgrade";

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

/**
 * Daily XP reward board — once per UTC day for every user while the board is live.
 * Day-keyed id + persistent dismiss = exactly one show/day after they close it.
 */
function buildDailyXpCandidate(now: number): PromoPopupCandidate | null {
  if (!isDailyXpLive(now)) return null;
  const day = getUtcDayWindow(now);
  return {
    id: `dailyXp:${utcDayKey(now)}`,
    kind: "dailyXp",
    /** After contest urgency, ahead of new contests / arrivals so all users see it daily. */
    priority: 45,
    endsAt: day.endsAt,
    persistent: true,
  };
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

function buildSparksUpgradeCandidate(now: number): PromoPopupCandidate | null {
  const endsAt =
    SPARKS_UPGRADE_PROMO_START_MS + SPARKS_UPGRADE_PROMO_DURATION_MS;
  if (now < SPARKS_UPGRADE_PROMO_START_MS || now >= endsAt) return null;
  return {
    id: SPARKS_UPGRADE_PROMO_ID,
    kind: "sparksUpgrade",
    /** Above contest/week so every visitor sees it first while live. */
    priority: 5,
    endsAt,
    persistent: true,
  };
}

function isCapExemptPromo(kind: PromoPopupKind): boolean {
  return kind === "sparksUpgrade" || kind === "dailyXp";
}

/**
 * Eligible promos for this moment, sorted by priority (highest first).
 * Host shows at most one per app open; daily cap still limits how many
 * opens in a UTC day can surface a promo (max 3).
 * Sparks-upgrade + Daily XP reward bypass the daily cap so everyone can see them.
 */
export function buildPromoQueue(
  games: Game[],
  now = Date.now()
): PromoPopupCandidate[] {
  const remainingSlots = getPromoRemainingSlotsToday(now);
  const sparksUpgrade = buildSparksUpgradeCandidate(now);
  const dailyXp = buildDailyXpCandidate(now);

  const raw: PromoPopupCandidate[] = [
    ...(sparksUpgrade ? [sparksUpgrade] : []),
    ...(dailyXp ? [dailyXp] : []),
    ...buildGameCandidates(games, now),
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

  if (remainingSlots <= 0) {
    return eligible.filter((item) => isCapExemptPromo(item.kind)).slice(0, 1);
  }

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
    case "dailyXp":
      return "Earn Daily";
    case "communityTelegram":
      return "Join Telegram";
    case "communityX":
      return "Follow on X";
    case "sparksUpgrade":
      return "More Sparks, more plays";
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
    case "dailyXp":
      return `Reach ${DAILY_XP_THRESHOLD} XP today → Claim $${DAILY_XP_REWARD_USDT.toFixed(2)} USDT.`;
    case "communityTelegram":
      return "Join the Telegram community to stay up to date on the latest ArcadeX news.";
    case "communityX":
      return "Follow ArcadeX on X for the latest updates and drops.";
    case "sparksUpgrade":
      return `Your Spark bar just got bigger — you now get ${SPARK_MAX} Sparks. Play more games and climb the XP boards faster.`;
  }
}

export function getPromoCtaLabel(item: PromoPopupCandidate): string {
  switch (item.kind) {
    case "newGame":
      return "Try it out";
    case "contestStart":
    case "contestEnd":
      return "Let's Go";
    case "dailyXp":
      return "Let's Play";
    case "communityTelegram":
      return "Join now";
    case "communityX":
      return "Follow now";
    case "sparksUpgrade":
      return "Start playing";
  }
}

export function isCommunityPromo(kind: PromoPopupKind): boolean {
  return kind === "communityTelegram" || kind === "communityX";
}

export function isContestPromo(kind: PromoPopupKind): boolean {
  return kind === "contestStart" || kind === "contestEnd";
}

export function isLeaderboardPromo(kind: PromoPopupKind): boolean {
  return kind === "dailyXp";
}

export function isSparksUpgradePromo(kind: PromoPopupKind): boolean {
  return kind === "sparksUpgrade";
}
