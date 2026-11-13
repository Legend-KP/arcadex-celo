import { utcDayKey } from "@/lib/activity-week";
import { isContestActive } from "@/lib/contest";
import {
  DAILY_XP_REWARD_USDT,
  DAILY_XP_THRESHOLD,
  getUtcDayWindow,
  isDailyXpLive,
} from "@/lib/daily-xp-board";
import { isDailyXpUiEnabled } from "@/lib/feature-flags";
import {
  canShowLiveContestsToday,
  getLiveContestsShownCountToday,
  getPromoRemainingSlotsToday,
  isPromoEventRead,
  wasPromoShownToday,
} from "@/lib/promo-popups-seen";
import {
  INFINITE_SPARK_SALE_END_MS,
  INFINITE_SPARK_SALE_PROMO_ID,
  INFINITE_SPARK_SALE_START_MS,
  isInfiniteSparkSaleLive,
} from "@/lib/infinite-spark-sale";
import { SPARK_MAX } from "@/lib/spark";
import {
  Game,
  gameIsLive,
  gameIsNewArrival,
  gameIsTest,
} from "@/types";

/** @deprecated Kept for older stored promo ids; new queue uses liveContests. */
export const PROMO_MILESTONES_HOURS = [12, 6, 3, 1] as const;
export type ContestPromoMilestoneHours = (typeof PROMO_MILESTONES_HOURS)[number];

export type PromoMilestoneHours = ContestPromoMilestoneHours;

/** Sparks-cap announcement window (UTC). Shown once per user while active. */
export const SPARKS_UPGRADE_PROMO_START_MS = Date.UTC(2026, 8, 30);
export const SPARKS_UPGRADE_PROMO_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
export const SPARKS_UPGRADE_PROMO_ID = `sparksUpgrade:${SPARK_MAX}`;

export type PromoPopupKind =
  | "liveContests"
  | "dailyXp"
  | "newGame"
  | "communityTelegram"
  | "communityX"
  | "sparksUpgrade"
  | "infiniteSparkSale";

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

function liveContestSignature(games: Game[], now: number): string | null {
  const parts: string[] = [];
  for (const game of games) {
    if (!game.active || gameIsTest(game) || !gameIsLive(game)) continue;
    if (!isContestActive(game, now)) continue;
    const startedAt = game.contestStartedAt;
    if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) continue;
    parts.push(`${game.id}:${startedAt}`);
  }
  if (parts.length === 0) return null;
  parts.sort();
  return parts.join("|");
}

function buildLiveContestsCandidate(
  games: Game[],
  now: number
): PromoPopupCandidate | null {
  const signature = liveContestSignature(games, now);
  if (!signature) return null;
  if (!canShowLiveContestsToday(now)) return null;
  const day = utcDayKey(now);
  const shown = getLiveContestsShownCountToday(now);
  return {
    // Unique slot id so the same contest set can appear up to 3× / UTC day.
    id: `liveContests:${day}:${shown}`,
    kind: "liveContests",
    /** After sparks / daily XP urgency; ahead of new arrivals & community. */
    priority: 55,
    /** Not permanent — closing only consumes one of today's 3 slots. */
    persistent: false,
  };
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
  }

  return out;
}

/**
 * Daily XP reward board — once per UTC day for every user while the board is live.
 * Day-keyed id + persistent dismiss = exactly one show/day after they close it.
 */
function buildDailyXpCandidate(now: number): PromoPopupCandidate | null {
  // Daily XP board promo — kept in code, gated off with the rest of Daily XP UI.
  if (!isDailyXpUiEnabled()) return null;
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

function buildInfiniteSparkSaleCandidate(
  now: number
): PromoPopupCandidate | null {
  if (!isInfiniteSparkSaleLive(now)) return null;
  // Guard against stale clocks outside the configured window constants.
  if (now < INFINITE_SPARK_SALE_START_MS || now >= INFINITE_SPARK_SALE_END_MS) {
    return null;
  }
  return {
    id: INFINITE_SPARK_SALE_PROMO_ID,
    kind: "infiniteSparkSale",
    /** Highest while live so the half-off poster surfaces first. */
    priority: 1,
    endsAt: INFINITE_SPARK_SALE_END_MS,
    persistent: true,
  };
}

function isCapExemptPromo(kind: PromoPopupKind): boolean {
  return (
    kind === "sparksUpgrade" ||
    kind === "dailyXp" ||
    kind === "liveContests" ||
    kind === "infiniteSparkSale"
  );
}

/**
 * Eligible promos for this moment, sorted by priority (highest first).
 * Host shows at most one per app open; daily cap still limits how many
 * opens in a UTC day can surface a promo (max 3).
 * Sparks-upgrade, Daily XP, Live Contests, and Infinite Spark sale bypass
 * the shared daily cap. Live Contests itself is allowed up to 3 shows / UTC day.
 */
export function buildPromoQueue(
  games: Game[],
  now = Date.now()
): PromoPopupCandidate[] {
  const remainingSlots = getPromoRemainingSlotsToday(now);
  const infiniteSparkSale = buildInfiniteSparkSaleCandidate(now);
  const sparksUpgrade = buildSparksUpgradeCandidate(now);
  const dailyXp = buildDailyXpCandidate(now);
  const liveContests = buildLiveContestsCandidate(games, now);

  const raw: PromoPopupCandidate[] = [
    ...(infiniteSparkSale ? [infiniteSparkSale] : []),
    ...(sparksUpgrade ? [sparksUpgrade] : []),
    ...(dailyXp ? [dailyXp] : []),
    ...(liveContests ? [liveContests] : []),
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
    case "liveContests":
      return "Live Contests";
    case "dailyXp":
      return "Earn Daily";
    case "communityTelegram":
      return "Join Telegram";
    case "communityX":
      return "Follow on X";
    case "sparksUpgrade":
      return "More Sparks, more plays";
    case "infiniteSparkSale":
      return "Infinite Spark";
  }
}

export function getPromoBody(item: PromoPopupCandidate): string {
  switch (item.kind) {
    case "newGame":
      return item.gameName
        ? `${item.gameName} is live on ArcadeX. Jump in and try it out.`
        : "A new game is live on ArcadeX. Jump in and try it out.";
    case "liveContests":
      return "Play, compete, and earn USDT rewards in live contests.";
    case "dailyXp":
      return `Reach ${DAILY_XP_THRESHOLD} XP today → Claim $${DAILY_XP_REWARD_USDT.toFixed(2)} USDT.`;
    case "communityTelegram":
      return "Join the Telegram community to stay up to date on the latest ArcadeX news.";
    case "communityX":
      return "Follow ArcadeX on X for the latest updates and drops.";
    case "sparksUpgrade":
      return `Your Spark bar just got bigger — you now get ${SPARK_MAX} Sparks. Play more games and climb the XP boards faster.`;
    case "infiniteSparkSale":
      return "Get unlimited game access for 50% off.";
  }
}

export function getPromoCtaLabel(item: PromoPopupCandidate): string {
  switch (item.kind) {
    case "newGame":
      return "Try it out";
    case "liveContests":
      return "Play Now";
    case "dailyXp":
      return "Let's Play";
    case "communityTelegram":
      return "Join now";
    case "communityX":
      return "Follow now";
    case "sparksUpgrade":
      return "Start playing";
    case "infiniteSparkSale":
      return "Grab it";
  }
}

export function isCommunityPromo(kind: PromoPopupKind): boolean {
  return kind === "communityTelegram" || kind === "communityX";
}

export function isContestPromo(kind: PromoPopupKind): boolean {
  return kind === "liveContests";
}

export function isLeaderboardPromo(kind: PromoPopupKind): boolean {
  return kind === "dailyXp";
}

export function isSparksUpgradePromo(kind: PromoPopupKind): boolean {
  return kind === "sparksUpgrade";
}

export function isInfiniteSparkSalePromo(kind: PromoPopupKind): boolean {
  return kind === "infiniteSparkSale";
}
