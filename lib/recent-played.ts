const STORAGE_KEY = "arcadex_recent_played";
const MAX_ENTRIES = 40;

export type RecentPlayedEntry = {
  gameId: string;
  playedAt: number;
};

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function readRaw(): RecentPlayedEntry[] {
  if (!canUseStorage()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const row = item as Record<string, unknown>;
        const gameId = typeof row.gameId === "string" ? row.gameId : "";
        const playedAt =
          typeof row.playedAt === "number" && Number.isFinite(row.playedAt)
            ? row.playedAt
            : 0;
        if (!gameId || playedAt <= 0) return null;
        return { gameId, playedAt };
      })
      .filter((entry): entry is RecentPlayedEntry => entry !== null);
  } catch {
    return [];
  }
}

function writeRaw(entries: RecentPlayedEntry[]): void {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // Quota / private mode — ignore
  }
}

/** Most-recent-first list of game IDs the player opened. */
export function getRecentPlayedIds(): string[] {
  return readRaw()
    .sort((a, b) => b.playedAt - a.playedAt)
    .map((entry) => entry.gameId);
}

/** Map of gameId → last played timestamp (ms). */
export function getRecentPlayedMap(): Record<string, number> {
  const map: Record<string, number> = {};
  for (const entry of readRaw()) {
    const prev = map[entry.gameId];
    if (prev === undefined || entry.playedAt > prev) {
      map[entry.gameId] = entry.playedAt;
    }
  }
  return map;
}

/** Record that the player opened / played a game (idempotent bump to front). */
export function recordRecentPlayed(gameId: string): void {
  const id = gameId.trim();
  if (!id) return;
  const now = Date.now();
  const next = [
    { gameId: id, playedAt: now },
    ...readRaw().filter((entry) => entry.gameId !== id),
  ];
  writeRaw(next);
}
