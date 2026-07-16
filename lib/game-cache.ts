import { Game } from "@/types";

/** Full games list — refreshed on admin mutations. */
export const GAME_LIST_TTL_MS = 60_000;

/** Single game doc — admin edits are rare. */
export const GAME_DOC_TTL_MS = 300_000;

/** HTTP Cache-Control for GET /api/games. */
export const GAMES_API_MAX_AGE_SEC = 60;
export const GAMES_API_STALE_WHILE_REVALIDATE_SEC = 120;

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

let gameListEntry: CacheEntry<Game[]> | null = null;
const gameDocEntries = new Map<string, CacheEntry<Game>>();

/** Served when Firestore is unavailable (circuit breaker). */
let lastGoodGameList: Game[] | null = null;
const lastGoodGameDocs = new Map<string, Game>();

let firestoreCircuitOpenUntil = 0;
let firestoreConsecutiveFailures = 0;

export type GameCacheStats = {
  listHits: number;
  listMisses: number;
  docHits: number;
  docMisses: number;
  circuitBreakerTrips: number;
};

const stats: GameCacheStats = {
  listHits: 0,
  listMisses: 0,
  docHits: 0,
  docMisses: 0,
  circuitBreakerTrips: 0,
};

export function getGameCacheStats(): Readonly<GameCacheStats> {
  return { ...stats };
}

function isFresh<T>(entry: CacheEntry<T> | null | undefined): entry is CacheEntry<T> {
  return Boolean(entry && Date.now() < entry.expiresAt);
}

export function getCachedGameList(): Game[] | null {
  if (isFresh(gameListEntry)) {
    stats.listHits += 1;
    return gameListEntry.value;
  }
  stats.listMisses += 1;
  return null;
}

export function setCachedGameList(games: Game[]): void {
  const expiresAt = Date.now() + GAME_LIST_TTL_MS;
  gameListEntry = { value: games, expiresAt };
  lastGoodGameList = games;
  for (const game of games) {
    setCachedGameDoc(game.id, game);
  }
}

export function getCachedGameDoc(id: string): Game | null {
  const entry = gameDocEntries.get(id);
  if (isFresh(entry)) {
    stats.docHits += 1;
    return entry.value;
  }
  stats.docMisses += 1;
  return null;
}

export function setCachedGameDoc(id: string, game: Game): void {
  gameDocEntries.set(id, {
    value: game,
    expiresAt: Date.now() + GAME_DOC_TTL_MS,
  });
  lastGoodGameDocs.set(id, game);
}

/** Clear single-doc cache first, then list (invalidation order). */
export function invalidateGameCache(gameId?: string): void {
  if (gameId) {
    gameDocEntries.delete(gameId);
    lastGoodGameDocs.delete(gameId);
  } else {
    gameDocEntries.clear();
    lastGoodGameDocs.clear();
  }
  gameListEntry = null;
}

export function getStaleGameListFallback(): Game[] | null {
  return lastGoodGameList;
}

export function getStaleGameDocFallback(id: string): Game | null {
  return lastGoodGameDocs.get(id) ?? null;
}

export function isFirestoreCircuitOpen(): boolean {
  return Date.now() < firestoreCircuitOpenUntil;
}

export function recordFirestoreSuccess(): void {
  firestoreConsecutiveFailures = 0;
  firestoreCircuitOpenUntil = 0;
}

const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_OPEN_MS = 30_000;

export function recordFirestoreFailure(status?: number): void {
  const isQuotaOrServer =
    status === 429 || status === 503 || (status !== undefined && status >= 500);

  if (!isQuotaOrServer && status !== undefined && status < 500) {
    return;
  }

  firestoreConsecutiveFailures += 1;
  if (firestoreConsecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
    firestoreCircuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
    stats.circuitBreakerTrips += 1;
    firestoreConsecutiveFailures = 0;
  }
}
