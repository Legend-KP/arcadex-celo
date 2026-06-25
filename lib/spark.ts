import { SparkSnapshot, StoredSparkState } from "@/types";

export const SPARK_MAX = 3;
export const SPARK_REGEN_MS = 180 * 60 * 1000;

export function defaultSparkState(): StoredSparkState {
  return {
    max: SPARK_MAX,
    regenMs: SPARK_REGEN_MS,
    slots: Array.from({ length: SPARK_MAX }, () => null),
  };
}

/** Normalize expired regen timestamps back to ready (`null`). */
export function normalizeSparkState(
  state: StoredSparkState,
  now = Date.now()
): StoredSparkState {
  const slots = state.slots.map((slot) =>
    slot !== null && slot <= now ? null : slot
  );
  const infiniteUntil =
    state.infiniteUntil && state.infiniteUntil > now
      ? state.infiniteUntil
      : undefined;

  return {
    max: state.max,
    regenMs: state.regenMs,
    slots,
    ...(infiniteUntil ? { infiniteUntil } : {}),
  };
}

function slotFill(
  readyAt: number | null,
  now: number,
  regenMs: number
): number {
  if (readyAt === null || now >= readyAt) return 1;
  return 1 - (readyAt - now) / regenMs;
}

export function computeSparkSnapshot(
  raw: StoredSparkState,
  now = Date.now()
): SparkSnapshot {
  const state = normalizeSparkState(raw, now);
  const { max, regenMs, slots } = state;

  const available = slots.filter(
    (slot) => slot === null || slot <= now
  ).length;

  let fillSum = 0;
  for (const slot of slots) {
    fillSum += slotFill(slot, now, regenMs);
  }
  const fillLevel = fillSum / max;
  const fillPercent = Math.min(100, Math.max(0, fillLevel * 100));

  const pending = slots.filter(
    (slot): slot is number => slot !== null && slot > now
  );
  const timeToFullMs =
    pending.length === 0 ? 0 : Math.max(...pending) - now;

  const hasInfinite = Boolean(
    state.infiniteUntil && state.infiniteUntil > now
  );

  return {
    max,
    available,
    fillPercent,
    timeToFullMs,
    hasInfinite,
    ...(hasInfinite ? { infiniteUntil: state.infiniteUntil } : {}),
  };
}

export function formatSparkDuration(ms: number): string {
  if (ms <= 0) return "Ready now";

  const totalMinutes = Math.ceil(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}
