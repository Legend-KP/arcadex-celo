/**
 * 30-day streak ladder (FINAL product table).
 *
 * Phase A: UI preview only when NEXT_PUBLIC_STREAK_LADDER_V2 is on.
 * Grants / USDT claim / campaign flip come in later phases — do not
 * treat this table as live payout authority until those ship.
 */

export const STREAK_LADDER_REQUIRED_DAYS = 30;
export const STREAK_BASE_XP = 10;

/** Enable 30-day ladder UI without changing STREAK_CAMPAIGN_ID. */
export function isStreakLadderV2Enabled(): boolean {
  const raw = process.env.NEXT_PUBLIC_STREAK_LADDER_V2?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

export interface StreakDayReward {
  day: number;
  /** Total activity XP granted that check-in (base + bonus). */
  xp: number;
  /** Extra XP beyond STREAK_BASE_XP. */
  xpBonus: number;
  /** USDT human units, or null. */
  usdt: number | null;
  /** Infinite Spark duration in hours, or null. */
  infiniteHours: number | null;
}

type DayExtras = {
  xpBonus?: number;
  usdt?: number;
  infiniteHours?: number;
};

/** Sparse extras keyed by day; every other day is base XP only. */
const STREAK_DAY_EXTRAS: Readonly<Record<number, DayExtras>> = {
  3: { xpBonus: 50 },
  5: { infiniteHours: 6 },
  7: { usdt: 0.001 },
  10: { infiniteHours: 12 },
  14: { usdt: 0.005 },
  18: { xpBonus: 100, infiniteHours: 6 },
  21: { usdt: 0.005, infiniteHours: 6 },
  24: { xpBonus: 100, infiniteHours: 12 },
  27: { xpBonus: 150, infiniteHours: 24 },
  30: { xpBonus: 200, usdt: 0.05, infiniteHours: 24 },
};

function buildDayReward(day: number): StreakDayReward {
  const extras = STREAK_DAY_EXTRAS[day] ?? {};
  const xpBonus = extras.xpBonus ?? 0;
  return {
    day,
    xp: STREAK_BASE_XP + xpBonus,
    xpBonus,
    usdt: extras.usdt ?? null,
    infiniteHours: extras.infiniteHours ?? null,
  };
}

/** Full D1–D30 table (immutable). */
export const STREAK_LADDER_REWARDS: readonly StreakDayReward[] = Array.from(
  { length: STREAK_LADDER_REQUIRED_DAYS },
  (_, i) => buildDayReward(i + 1)
);

export function getStreakDayReward(day: number): StreakDayReward | null {
  if (
    !Number.isInteger(day) ||
    day < 1 ||
    day > STREAK_LADDER_REQUIRED_DAYS
  ) {
    return null;
  }
  return STREAK_LADDER_REWARDS[day - 1] ?? null;
}

export function isStreakHighlightDay(reward: StreakDayReward): boolean {
  return (
    reward.xpBonus > 0 ||
    reward.usdt != null ||
    reward.infiniteHours != null
  );
}

/** Four week rows for the check-in UI (last week has days 22–30). */
export function getStreakLadderWeeks(): ReadonlyArray<{
  week: number;
  label: string;
  days: readonly number[];
}> {
  return [
    { week: 1, label: "Week 1 · Days 1–7", days: [1, 2, 3, 4, 5, 6, 7] },
    { week: 2, label: "Week 2 · Days 8–14", days: [8, 9, 10, 11, 12, 13, 14] },
    {
      week: 3,
      label: "Week 3 · Days 15–21",
      days: [15, 16, 17, 18, 19, 20, 21],
    },
    {
      week: 4,
      label: "Week 4 · Days 22–30",
      days: [22, 23, 24, 25, 26, 27, 28, 29, 30],
    },
  ];
}

export function formatUsdtAmount(amount: number): string {
  if (amount >= 0.01) {
    return `${amount} USDT`;
  }
  // Keep micro prizes readable (0.001 / 0.005).
  return `${amount.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")} USDT`;
}

export function formatStreakRewardDetail(reward: StreakDayReward): string {
  const parts: string[] = [];
  if (reward.xpBonus > 0) {
    parts.push(`${reward.xp} XP`);
  } else {
    parts.push(`+${reward.xp} XP`);
  }
  if (reward.usdt != null) {
    parts.push(formatUsdtAmount(reward.usdt));
  }
  if (reward.infiniteHours != null) {
    parts.push(`Infinite Spark · ${reward.infiniteHours}h`);
  }
  return parts.join(" · ");
}

/**
 * Next reward to spotlight in the modal: today's check-in reward if it is a
 * highlight day, otherwise the next highlight day after (or including) today.
 */
export function getStreakRewardSpotlight(
  checkInDay: number
): { reward: StreakDayReward; isToday: boolean } | null {
  const today = getStreakDayReward(checkInDay);
  if (today && isStreakHighlightDay(today)) {
    return { reward: today, isToday: true };
  }
  for (let day = Math.max(1, checkInDay); day <= STREAK_LADDER_REQUIRED_DAYS; day++) {
    const reward = getStreakDayReward(day);
    if (reward && isStreakHighlightDay(reward)) {
      return { reward, isToday: day === checkInDay };
    }
  }
  return today ? { reward: today, isToday: true } : null;
}

/** Full-run totals for docs / UI footers. */
export const STREAK_LADDER_TOTALS = {
  xp: STREAK_LADDER_REWARDS.reduce((sum, r) => sum + r.xp, 0),
  usdt: STREAK_LADDER_REWARDS.reduce((sum, r) => sum + (r.usdt ?? 0), 0),
  sparkDays: STREAK_LADDER_REWARDS.filter((r) => r.infiniteHours != null).map(
    (r) => r.day
  ),
} as const;
