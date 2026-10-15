/**
 * Per-game open claim — $0.005 USDT once per UTC day per (wallet, game).
 * Option C: one SHUFFLE campaign per game → on-chain spin + claim (Celoscan).
 */

import { utcDayKey } from "@/lib/activity-week";

export const GAME_OPEN_CLAIM_USDT = 0.005;
/** On-chain amount (USDT, 6 decimals). */
export const GAME_OPEN_CLAIM_AMOUNT_MICRO = 5_000;
export const GAME_OPEN_CLAIM_REWARD_AMOUNT = BigInt(5_000);

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
