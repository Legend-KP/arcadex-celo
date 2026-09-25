import { Game } from "@/types";
import { publicCatalogFromFull } from "@/lib/game-visibility";
import { invalidateGameFlagsCache } from "@/lib/rtdb-cache";
import { getWorkerKv } from "@/lib/worker-kv";

/**
 * In-memory games list TTL. Admin mutations bump catalog generation so other
 * isolates drop memory early; this only bounds how long one isolate keeps a
 * list without re-checking shared KV.
 */
export const GAME_LIST_TTL_MS = 10 * 60_000;

/** Single game doc — admin edits are rare. */
export const GAME_DOC_TTL_MS = 300_000;

/**
 * Hide / Coming Soon are admin-toggled. Never HTTP-cache the catalog:
 * public vs admin responses differ, and CDN cache hid those changes.
 */
export const GAMES_API_CACHE_CONTROL =
  "private, no-store, no-cache, must-revalidate";

const CATALOG_GEN_KV_KEY = "cache:gamesCatalog:gen";
const CATALOG_GEN_KV_TTL_SEC = 60 * 60 * 24 * 7;
/** Public subset only (live + Coming Soon). v2 — do not store hidden/test. */
const CATALOG_PUBLIC_KV_KEY = "cache:gamesCatalog:public:v2";
/** Legacy key from pre-public-filter cache — delete on bump so stale full lists die. */
const CATALOG_LIST_KV_KEY_LEGACY = "cache:gamesCatalog:list:v1";
const CATALOG_PUBLIC_KV_TTL_SEC = CATALOG_GEN_KV_TTL_SEC;

export type PublicCatalogSnapshot = {
  games: Game[];
  testGameId: string | null;
};

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

/** Full catalog (incl. hidden/test) — admin + mutations only; never written to public KV. */
let fullGameListEntry: CacheEntry<Game[]> | null = null;
/** Public subset — home / MiniPay. */
let publicGameListEntry: CacheEntry<Game[]> | null = null;
let cachedTestGameId: string | null = null;

const gameDocEntries = new Map<string, CacheEntry<Game>>();

/** Served when Firestore is unavailable (circuit breaker). */
let lastGoodFullGameList: Game[] | null = null;
let lastGoodPublicGameList: Game[] | null = null;
const lastGoodGameDocs = new Map<string, Game>();

let firestoreCircuitOpenUntil = 0;
let firestoreConsecutiveFailures = 0;

/** Shared catalog generation — other isolates drop memory cache when this changes. */
let localCatalogGeneration: number | null = null;
let catalogEpoch = 0;

export function getCatalogEpoch(): number {
  return catalogEpoch;
}

function bumpLocalEpoch(): void {
  catalogEpoch += 1;
}

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

export function getCachedFullGameList(): Game[] | null {
  if (isFresh(fullGameListEntry)) {
    stats.listHits += 1;
    return fullGameListEntry.value;
  }
  stats.listMisses += 1;
  return null;
}

export function getCachedPublicGameList(): Game[] | null {
  if (isFresh(publicGameListEntry)) {
    stats.listHits += 1;
    return publicGameListEntry.value;
  }
  // Derive from a warm full list without a false miss.
  if (isFresh(fullGameListEntry)) {
    stats.listHits += 1;
    const snap = publicCatalogFromFull(fullGameListEntry.value);
    publicGameListEntry = {
      value: snap.games,
      expiresAt: fullGameListEntry.expiresAt,
    };
    cachedTestGameId = snap.testGameId;
    return snap.games;
  }
  stats.listMisses += 1;
  return null;
}

/** @deprecated Prefer getCachedFullGameList / getCachedPublicGameList. */
export function getCachedGameList(): Game[] | null {
  return getCachedFullGameList();
}

/**
 * Store full catalog in memory and (by default) write the **public** subset to KV.
 * Invariant for home: memory → public KV → Firestore list → write public KV.
 */
export function setCachedFullGameList(
  games: Game[],
  persistPublic = true
): PublicCatalogSnapshot {
  const expiresAt = Date.now() + GAME_LIST_TTL_MS;
  const publicSnap = publicCatalogFromFull(games);

  fullGameListEntry = { value: games, expiresAt };
  publicGameListEntry = { value: publicSnap.games, expiresAt };
  cachedTestGameId = publicSnap.testGameId;
  lastGoodFullGameList = games;
  lastGoodPublicGameList = publicSnap.games;

  for (const game of games) {
    setCachedGameDoc(game.id, game);
  }

  if (persistPublic) void persistSharedPublicCatalog(publicSnap);
  return publicSnap;
}

/** @deprecated Prefer setCachedFullGameList. */
export function setCachedGameList(games: Game[], persistShared = true): void {
  setCachedFullGameList(games, persistShared);
}

async function persistSharedPublicCatalog(
  snapshot: PublicCatalogSnapshot
): Promise<void> {
  try {
    const kv = await getWorkerKv();
    await kv?.put(CATALOG_PUBLIC_KV_KEY, JSON.stringify(snapshot), {
      expirationTtl: CATALOG_PUBLIC_KV_TTL_SEC,
    });
  } catch {
    // Memory cache still valid if KV is unavailable.
  }
}

/** Shared public catalog — cold isolates serve MiniPay home without Firestore. */
export async function readSharedPublicCatalog(): Promise<PublicCatalogSnapshot | null> {
  try {
    const kv = await getWorkerKv();
    const raw = await kv?.get(CATALOG_PUBLIC_KV_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      games?: Game[];
      testGameId?: string | null;
    };
    if (!Array.isArray(parsed.games) || parsed.games.length === 0) return null;
    return {
      games: parsed.games,
      testGameId:
        typeof parsed.testGameId === "string" ? parsed.testGameId : null,
    };
  } catch {
    return null;
  }
}

/** @deprecated Prefer readSharedPublicCatalog. */
export async function readSharedCatalogList(): Promise<Game[] | null> {
  const snap = await readSharedPublicCatalog();
  return snap?.games ?? null;
}

async function deleteSharedCatalogLists(): Promise<void> {
  try {
    const kv = await getWorkerKv();
    await kv?.delete?.(CATALOG_PUBLIC_KV_KEY);
    await kv?.delete?.(CATALOG_LIST_KV_KEY_LEGACY);
  } catch {
    // Next TTL expiry still drops a stale list.
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

function replaceGameInList(list: Game[], game: Game): Game[] {
  const idx = list.findIndex((g) => g.id === game.id);
  if (idx === -1) return [...list, game];
  return list.map((g) => (g.id === game.id ? game : g));
}

/**
 * Keep memory in sync after a single-doc patch. Always re-persists **public** KV
 * from the full list (never writes hidden games to the public key).
 */
export function upsertCachedGame(game: Game): void {
  setCachedGameDoc(game.id, game);

  if (fullGameListEntry) {
    const next = replaceGameInList(fullGameListEntry.value, game);
    setCachedFullGameList(next, true);
    return;
  }

  if (lastGoodFullGameList) {
    const next = replaceGameInList(lastGoodFullGameList, game);
    setCachedFullGameList(next, true);
    return;
  }

  // No full list — only warm the doc; do not poison public KV with a 1-game list.
}

function dropFreshCatalogCaches(): void {
  bumpLocalEpoch();
  fullGameListEntry = null;
  publicGameListEntry = null;
  cachedTestGameId = null;
  gameDocEntries.clear();
  invalidateGameFlagsCache();
}

/**
 * If another isolate bumped the catalog generation (Hide / Coming Soon),
 * drop this isolate's in-memory games so the next read uses shared public KV
 * (or Firestore if KV was cleared without republish).
 */
/** @returns true when this isolate dropped memory because generation changed */
export async function refreshCatalogCacheIfStale(): Promise<boolean> {
  try {
    const kv = await getWorkerKv();
    const raw = await kv?.get(CATALOG_GEN_KV_KEY);
    if (!raw) return false;
    const shared = Number(raw);
    if (!Number.isFinite(shared) || shared === localCatalogGeneration) {
      return false;
    }
    dropFreshCatalogCaches();
    localCatalogGeneration = shared;
    return true;
  } catch {
    return false;
  }
}

/**
 * Call after every admin catalog mutation so other isolates see Hide / Live.
 * Prefer `republishCatalogSnapshot` which bumps gen and writes public KV together.
 */
export async function bumpCatalogGeneration(opts?: {
  /** When false, leave public KV in place for an immediate overwrite (eager republish). */
  clearListKv?: boolean;
}): Promise<void> {
  const clearListKv = opts?.clearListKv !== false;
  const next = Date.now();
  localCatalogGeneration = next;
  try {
    const kv = await getWorkerKv();
    await kv?.put(CATALOG_GEN_KV_KEY, String(next), {
      expirationTtl: CATALOG_GEN_KV_TTL_SEC,
    });
    if (clearListKv) {
      await kv?.delete?.(CATALOG_PUBLIC_KV_KEY);
      await kv?.delete?.(CATALOG_LIST_KV_KEY_LEGACY);
    }
  } catch {
    if (clearListKv) await deleteSharedCatalogLists();
  }
}

/**
 * Eager catalog publish after admin go-live / hide / reorder:
 * bump generation (without wiping KV first), then overwrite public KV + memory.
 * Other isolates drop memory on gen change and read the new public snapshot.
 */
export async function republishCatalogSnapshot(
  fullGames: Game[]
): Promise<PublicCatalogSnapshot> {
  await bumpCatalogGeneration({ clearListKv: false });
  try {
    const kv = await getWorkerKv();
    await kv?.delete?.(CATALOG_LIST_KV_KEY_LEGACY);
  } catch {
    // Best-effort legacy cleanup.
  }
  return setCachedFullGameList(fullGames, true);
}

/** Clear single-doc cache first, then list (invalidation order). */
export function invalidateGameCache(gameId?: string): void {
  bumpLocalEpoch();
  if (gameId) {
    gameDocEntries.delete(gameId);
  } else {
    gameDocEntries.clear();
    lastGoodGameDocs.clear();
    lastGoodFullGameList = null;
    lastGoodPublicGameList = null;
  }
  fullGameListEntry = null;
  publicGameListEntry = null;
  cachedTestGameId = null;
  invalidateGameFlagsCache(gameId);
}

/** Drop a deleted game from circuit-breaker fallbacks. */
export function removeCachedGame(gameId: string): void {
  invalidateGameCache(gameId);
  lastGoodGameDocs.delete(gameId);
  if (lastGoodFullGameList) {
    lastGoodFullGameList = lastGoodFullGameList.filter((g) => g.id !== gameId);
  }
  if (lastGoodPublicGameList) {
    lastGoodPublicGameList = lastGoodPublicGameList.filter(
      (g) => g.id !== gameId
    );
  }
}

export function getStaleFullGameListFallback(): Game[] | null {
  return lastGoodFullGameList;
}

export function getStalePublicGameListFallback(): Game[] | null {
  return lastGoodPublicGameList;
}

/** @deprecated Prefer getStaleFullGameListFallback / getStalePublicGameListFallback. */
export function getStaleGameListFallback(): Game[] | null {
  return lastGoodFullGameList;
}

export function getStaleGameDocFallback(id: string): Game | null {
  return lastGoodGameDocs.get(id) ?? null;
}

export function getCachedTestGameId(): string | null {
  return cachedTestGameId;
}

/**
 * Warm public memory (+ docs) from a shared KV snapshot without claiming it is
 * the full admin catalog (hidden games are absent).
 */
export function warmPublicCatalogMemory(
  snapshot: PublicCatalogSnapshot
): PublicCatalogSnapshot {
  const expiresAt = Date.now() + GAME_LIST_TTL_MS;
  publicGameListEntry = { value: snapshot.games, expiresAt };
  cachedTestGameId = snapshot.testGameId;
  lastGoodPublicGameList = snapshot.games;
  for (const game of snapshot.games) {
    setCachedGameDoc(game.id, game);
  }
  return snapshot;
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
