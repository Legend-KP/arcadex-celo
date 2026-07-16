import { GameGatingFlags } from "@/types";

/** Home-screen play counts — avoid re-downloading the full gamePlays tree every load. */
export const PLAY_COUNTS_TTL_MS = 45_000;

/** Hot-path gating flags — invalidated on admin game mutations. */
export const GAME_FLAGS_TTL_MS = 45_000;

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

let playCountsEntry: CacheEntry<Record<string, number>> | null = null;
const gameFlagsEntries = new Map<string, CacheEntry<GameGatingFlags>>();

function isFresh<T>(entry: CacheEntry<T> | null | undefined): entry is CacheEntry<T> {
  return Boolean(entry && Date.now() < entry.expiresAt);
}

export function getCachedPlayCounts(): Record<string, number> | null {
  if (isFresh(playCountsEntry)) return playCountsEntry.value;
  return null;
}

export function setCachedPlayCounts(counts: Record<string, number>): void {
  playCountsEntry = {
    value: { ...counts },
    expiresAt: Date.now() + PLAY_COUNTS_TTL_MS,
  };
}

/** Bump one game's cached count after an atomic RTDB increment (no full re-fetch). */
export function bumpCachedPlayCount(gameId: string, delta = 1): number | null {
  if (!isFresh(playCountsEntry)) return null;
  const next = { ...playCountsEntry.value };
  next[gameId] = (typeof next[gameId] === "number" ? next[gameId] : 0) + delta;
  playCountsEntry = {
    value: next,
    expiresAt: playCountsEntry.expiresAt,
  };
  return next[gameId];
}

export function invalidatePlayCountsCache(): void {
  playCountsEntry = null;
}

export function getCachedGameFlags(gameId: string): GameGatingFlags | null {
  const entry = gameFlagsEntries.get(gameId);
  if (isFresh(entry)) return entry.value;
  return null;
}

export function setCachedGameFlags(
  gameId: string,
  flags: GameGatingFlags
): void {
  gameFlagsEntries.set(gameId, {
    value: flags,
    expiresAt: Date.now() + GAME_FLAGS_TTL_MS,
  });
}

export function invalidateGameFlagsCache(gameId?: string): void {
  if (gameId) {
    gameFlagsEntries.delete(gameId);
    return;
  }
  gameFlagsEntries.clear();
}
