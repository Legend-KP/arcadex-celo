/**
 * Server-side 30-day streak ladder grants.
 *
 * Security model:
 * - Only callable after verifyCheckInTx (wallet = on-chain msg.sender)
 * - One grant per check-in txHash (payment_guards / RTDB guard)
 * - Day/amount taken from server table — never from the client
 * - USDT requires a second authenticated claim step + payout wallet
 * - Feature-flagged so UI can ship without opening the treasury
 */

import { getStreakDayReward, isStreakLadderV2Enabled } from "@/lib/streak-rewards";

export function isStreakLadderGrantsEnabled(): boolean {
  if (!isStreakLadderV2Enabled()) return false;
  const raw = process.env.STREAK_LADDER_GRANTS_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

export function isStreakUsdtPayoutsEnabled(): boolean {
  if (!isStreakLadderGrantsEnabled()) return false;
  const raw = process.env.STREAK_USDT_PAYOUTS_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

export function getStreakUsdtPayoutPrivateKey(): `0x${string}` | null {
  const key = process.env.STREAK_USDT_PAYOUT_PRIVATE_KEY?.trim();
  if (!key) return null;
  return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
}

/** Soft daily USDT ceiling across all streak claims (human units). */
export function getStreakDailyUsdtBudget(): number {
  const n = Number(process.env.STREAK_DAILY_USDT_BUDGET?.trim() || "3");
  return Number.isFinite(n) && n > 0 ? n : 3;
}

export function hoursToMs(hours: number): number {
  return Math.max(0, hours) * 60 * 60 * 1000;
}

export type StreakLadderGrantResult = {
  day: number;
  xpGranted: number;
  infiniteHoursGranted: number | null;
  usdtPending: number | null;
  needsUsdtClaim: boolean;
  sparks?: unknown;
  state?: unknown;
};

export function expectedUsdtForDay(day: number): number | null {
  return getStreakDayReward(day)?.usdt ?? null;
}
