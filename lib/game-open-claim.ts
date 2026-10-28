/**
 * Per-game open claim — $0.012 USDT once per UTC day per (wallet, game).
 * Option C: one SHUFFLE campaign per game → on-chain spin + claim (Celoscan).
 */

import { utcDayKey } from "@/lib/activity-week";

export const GAME_OPEN_CLAIM_USDT = 0.012;
/** Home banner display amount. */
export const GAME_OPEN_CLAIM_BANNER_USDT = 0.012;
/** Earn Now popup button label (display only — not the on-chain payout). */
export const GAME_OPEN_CLAIM_POPUP_USDT = 0.12;
/** On-chain amount (USDT, 6 decimals). */
export const GAME_OPEN_CLAIM_AMOUNT_MICRO = 12_000;
/**
 * Shared cap for new game-open claims across every game.
 * Each claim is one spin plus one claim on ArcadeXRewards.
 * Resets with gameOpenClaimDayKey (00:00 UTC).
 */
export const GAME_OPEN_CLAIM_DAILY_CAP = 5_000;
export const GAME_OPEN_CLAIM_REWARD_AMOUNT = BigInt(12_000);

export function gameOpenClaimDayKey(now = Date.now()): string {
  return utcDayKey(now);
}

export type GameOpenClaimRecord = {
  wallet: string;
  gameId: string;
  utcDay: string;
  campaignId: number;
  amountMicro: number;
  status: "pending" | "paying" | "claimed";
  claimTx: string | null;
  spinTx?: string | null;
  nonce?: number;
  createdAt: number;
  claimedAt: number | null;
};
