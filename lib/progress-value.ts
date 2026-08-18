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
