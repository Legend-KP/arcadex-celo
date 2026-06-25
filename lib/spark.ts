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

function coerceSlotValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

/** RTDB may return arrays as `{0:…,1:…}` objects or omit fields entirely. */
function coerceSlots(raw: unknown, max: number): (number | null)[] {
  if (Array.isArray(raw)) {
    const slots = raw.slice(0, max).map(coerceSlotValue);
    while (slots.length < max) slots.push(null);
    return slots;
  }

  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    const slots: (number | null)[] = [];
    for (let i = 0; i < max; i++) {
      slots.push(coerceSlotValue(record[i] ?? record[String(i)]));
    }
    return slots;
  }

  return Array.from({ length: max }, () => null);
}

export function coerceSparkState(raw: unknown): StoredSparkState {
  const defaults = defaultSparkState();
  if (!raw || typeof raw !== "object") return defaults;

  const data = raw as Partial<StoredSparkState>;
  const max =
    typeof data.max === "number" && data.max > 0
      ? Math.floor(data.max)
      : defaults.max;
  const regenMs =
    typeof data.regenMs === "number" && data.regenMs > 0
      ? data.regenMs
      : defaults.regenMs;
  const slots = coerceSlots(data.slots, max);
  const infiniteUntil =
    typeof data.infiniteUntil === "number" && Number.isFinite(data.infiniteUntil)
      ? data.infiniteUntil
      : undefined;

  return {
    max,
    regenMs,
    slots,
    ...(infiniteUntil ? { infiniteUntil } : {}),
  };
}

/** Normalize expired regen timestamps back to ready (`null`). */
export function normalizeSparkState(
  raw: StoredSparkState | unknown,
  now = Date.now()
): StoredSparkState {
  const state = coerceSparkState(raw);
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
