import { randomInt } from "crypto";
import {
  REWARD_OFFCHAIN,
  REWARD_USDT,
} from "@/lib/arcadex-rewards";

/** USDT on Celo uses 6 decimals. */
export const USDT_DECIMALS = 6;

export type ShuffleOutcomeType = "usdt" | "spark" | "none";

export interface ShuffleOutcomeDef {
  id: string;
  type: ShuffleOutcomeType;
  /** Display amount for USDT (human units). */
  amount: number | null;
  weight: number;
  label: string;
  sub: string;
  glyph: string;
  rarity: "legendary" | "rare" | "uncommon" | "spark" | "none";
}

/**
 * Server-only odds table. Client may mirror labels for theater, but never
 * trust a client-supplied outcome.
 */
export const SHUFFLE_OUTCOMES: ShuffleOutcomeDef[] = [
  {
    id: "usdt_1",
    type: "usdt",
    amount: 1,
    weight: 0.1,
    label: "1 USDT",
    sub: "Jackpot",
    glyph: "Ⓤ",
    rarity: "legendary",
  },
  {
    id: "usdt_p1",
    type: "usdt",
    amount: 0.1,
    weight: 1,
    label: "0.1 USDT",
    sub: "Big win",
    glyph: "Ⓤ",
    rarity: "rare",
  },
  {
    id: "usdt_p001",
    type: "usdt",
    amount: 0.001,
    weight: 5,
    label: "0.001 USDT",
    sub: "Small win",
    glyph: "Ⓤ",
    rarity: "uncommon",
  },
  {
    id: "spark",
    type: "spark",
    amount: null,
    weight: 15,
    label: "Infinite Spark",
    sub: "Unlimited plays · 24h",
    glyph: "⚡",
    rarity: "spark",
  },
  {
    id: "blnt1",
    type: "none",
    amount: null,
    weight: 39.9,
    label: "Better luck next time",
    sub: "Try again tomorrow",
    glyph: "✦",
    rarity: "none",
  },
  {
    id: "blnt2",
    type: "none",
    amount: null,
    weight: 39,
    label: "Better luck next time",
    sub: "So close!",
    glyph: "✦",
    rarity: "none",
  },
];

export const USDT_JACKPOT_COOLDOWN_MS = 15 * 24 * 60 * 60 * 1000;

export function usdtToBaseUnits(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** USDT_DECIMALS));
}

export function secureWeightedPick(
  outcomes: ShuffleOutcomeDef[] = SHUFFLE_OUTCOMES
): ShuffleOutcomeDef {
  const SCALE = 1000;
  const scaled = outcomes.map((o) => Math.round(o.weight * SCALE));
  const total = scaled.reduce((a, b) => a + b, 0);
  const roll = randomInt(0, total);
  let cursor = 0;
  for (let i = 0; i < outcomes.length; i++) {
    cursor += scaled[i];
    if (roll < cursor) return outcomes[i];
  }
  return outcomes[outcomes.length - 1];
}

/** After any USDT win, exclude USDT prizes for the cooldown window. */
export function pickShuffleOutcome(opts: {
  usdtBlocked: boolean;
}): ShuffleOutcomeDef {
  const pool = opts.usdtBlocked
    ? SHUFFLE_OUTCOMES.filter((o) => o.type !== "usdt")
    : SHUFFLE_OUTCOMES;
  return secureWeightedPick(pool);
}

export function outcomeToOnChainReward(outcome: ShuffleOutcomeDef): {
  rewardMode: number;
  rewardTarget: `0x${string}`;
  rewardAmount: bigint;
} {
  if (outcome.type === "usdt" && outcome.amount != null) {
    return {
      rewardMode: REWARD_USDT,
      rewardTarget: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
      rewardAmount: usdtToBaseUnits(outcome.amount),
    };
  }
  return {
    rewardMode: REWARD_OFFCHAIN,
    rewardTarget: "0x0000000000000000000000000000000000000000",
    rewardAmount: BigInt(0),
  };
}

/** Public labels for the theater grid (no weights). */
export function getShuffleTheaterCards() {
  return SHUFFLE_OUTCOMES.map(
    ({ id, type, amount, label, sub, glyph, rarity }) => ({
      id,
      type,
      amount,
      label,
      sub,
      glyph,
      rarity,
    })
  );
}
