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
  "mode",
  "difficulty",
  "difficultyName",
  "modes",
  "levels",
  "easy",
  "medium",
  "hard",
]);

const MODE_ALIASES: Record<string, string> = {
  easy: "easy",
  e: "easy",
  1: "easy",
  medium: "medium",
  med: "medium",
  normal: "medium",
  m: "medium",
  2: "medium",
  hard: "hard",
  h: "hard",
  3: "hard",
};

/** Normalize Easy / Medium / Hard (and common aliases) to a stable key. */
export function normalizeProgressMode(raw: unknown): string | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return MODE_ALIASES[String(Math.trunc(raw))];
  }
  if (typeof raw !== "string") return undefined;
  const key = raw.trim().toLowerCase();
  if (!key) return undefined;
  return MODE_ALIASES[key] ?? (/^[a-z0-9_-]{1,32}$/.test(key) ? key : undefined);
}

function readPositiveLevel(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return undefined;
  return Math.floor(raw);
}

function mergeModeLevel(
  into: Record<string, number>,
  mode: string | undefined,
  level: number | undefined
): void {
  if (!mode || level === undefined) return;
  into[mode] = Math.max(into[mode] ?? 0, level);
}

/**
 * Collect per-mode levels from Unity payloads (Line Link Easy/Medium/Hard).
 * Supports:
 * - `{ mode: "easy", level: 5 }`
 * - `{ easy: 5, medium: 2, hard: 1 }`
 * - `{ modes: { easy: 5 } }` / `{ levels: { easy: 5 } }`
 */
export function extractModeLevels(
  payload: Record<string, unknown> | null | undefined
): Record<string, number> | undefined {
  if (!payload) return undefined;

  const modes: Record<string, number> = {};

  const namedMode = normalizeProgressMode(
    payload.mode ?? payload.difficulty ?? payload.difficultyName
  );
  mergeModeLevel(modes, namedMode, readProgressNumber(payload));

  for (const key of ["easy", "medium", "hard"] as const) {
    mergeModeLevel(modes, key, readPositiveLevel(payload[key]));
  }

  for (const nestKey of ["modes", "levels"] as const) {
    const nested = payload[nestKey];
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) continue;
    for (const [rawMode, rawLevel] of Object.entries(
      nested as Record<string, unknown>
    )) {
      mergeModeLevel(
        modes,
        normalizeProgressMode(rawMode),
        readPositiveLevel(rawLevel)
      );
    }
  }

  const nestedState = payload.state;
  if (nestedState && typeof nestedState === "object" && !Array.isArray(nestedState)) {
    const fromState = extractModeLevels(nestedState as Record<string, unknown>);
    if (fromState) {
      for (const [mode, level] of Object.entries(fromState)) {
        mergeModeLevel(modes, mode, level);
      }
    }
  }

  return Object.keys(modes).length > 0 ? modes : undefined;
}

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
    for (const [key, value] of Object.entries(nested as Record<string, unknown>)) {
      if (PROGRESS_META_KEYS.has(key)) continue;
      extras[key] = value;
    }
  }

  return Object.keys(extras).length > 0 ? extras : undefined;
}
