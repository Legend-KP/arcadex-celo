/** Pick the first finite number from Unity / API progress payloads. */
export function readProgressNumber(input: {
  value?: unknown;
  score?: unknown;
  level?: unknown;
}): number | undefined {
  for (const key of ["value", "score", "level"] as const) {
    const raw = input[key];
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  }
  return undefined;
}

const PROGRESS_META_KEYS = new Set([
  "name",
  "score",
  "value",
  "level",
  "walletAddress",
  "playerName",
]);

/** Extra Unity fields that must be stored alongside s/l (Coin Sort stage, board, …). */
export function extractProgressExtras(
  payload: Record<string, unknown> | null | undefined
): Record<string, unknown> | undefined {
  if (!payload) return undefined;

  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (PROGRESS_META_KEYS.has(key)) continue;
    extras[key] = value;
  }

  const nested = payload.state;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    delete extras.state;
    Object.assign(extras, nested as Record<string, unknown>);
  }

  return Object.keys(extras).length > 0 ? extras : undefined;
}
