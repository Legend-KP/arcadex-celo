import { prependGameSortOrder, sortGames } from "@/lib/game-sort";
import {
  getCachedGameDoc,
  getCachedFullGameList,
  getCachedPublicGameList,
  getCachedTestGameId,
  readSharedPublicCatalog,
  getCatalogEpoch,
  getStaleGameDocFallback,
  getStaleFullGameListFallback,
  getStalePublicGameListFallback,
  isFirestoreCircuitOpen,
  recordFirestoreFailure,
  recordFirestoreSuccess,
  setCachedGameDoc,
  setCachedFullGameList,
  removeCachedGame,
  refreshCatalogCacheIfStale,
  republishCatalogSnapshot,
  warmPublicCatalogMemory,
  type PublicCatalogSnapshot,
} from "@/lib/game-cache";
import {
  publicCatalogFromFull,
} from "@/lib/game-visibility";
import { invalidateGameFlagsCache } from "@/lib/rtdb-cache";
import {
  deleteGameGatingFlagsFromRtdb,
  syncGameGatingFlagsToRtdb,
} from "@/lib/player-backend";
import { Game, GameGatingFlags } from "@/types";
import { getFirebaseAccessToken, getProjectId, getServiceAccount } from "@/lib/firebase-admin";
import { fetchWithTimeout } from "@/lib/firebase-fetch";
import { noteFirestoreReads } from "@/lib/firestore-read-counter";
import { normalizeImageAssetUrl } from "@/lib/game-assets";

export { isGameInPublicCatalog, isGameVisible } from "@/lib/game-visibility";

type FirestoreValue = {
  stringValue?: string;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
};

type FirestoreDocument = {
  name: string;
  fields: Record<string, FirestoreValue>;
};

/** Coalesce concurrent full-catalog loads on the same isolate. */
let gamesListInFlight: Promise<Game[]> | null = null;
let gamesListInFlightEpoch = -1;
/** Coalesce concurrent public-catalog loads on the same isolate. */
let publicCatalogInFlight: Promise<PublicCatalogSnapshot> | null = null;
let publicCatalogInFlightEpoch = -1;

function parseField(value: FirestoreValue | undefined): unknown {
  if (!value) return undefined;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  return undefined;
}

/** Admin toggles must stay false when explicitly off (string/number safe). */
function parseBooleanFlag(value: unknown, defaultTrue: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "false" || normalized === "0" || normalized === "no") {
      return false;
    }
    if (normalized === "true" || normalized === "1" || normalized === "yes") {
      return true;
    }
  }
  if (value === undefined || value === null) return defaultTrue;
  return defaultTrue;
}

function docToGame(doc: FirestoreDocument): Game {
  const id = doc.name.split("/").pop() ?? "";
  const fields = doc.fields;
  return {
    id,
    name: String(parseField(fields.name) ?? ""),
    thumbnail: String(parseField(fields.thumbnail) ?? ""),
    logo: parseField(fields.logo) as string | undefined,
    url: String(parseField(fields.url) ?? ""),
    plays: String(parseField(fields.plays) ?? "0"),
    fallbackImage: normalizeImageAssetUrl(
      parseField(fields.fallbackImage)
    ),
    active: parseBooleanFlag(parseField(fields.active), true),
    isTest: parseField(fields.isTest) === true,
    live: parseBooleanFlag(parseField(fields.live), true),
    hasLeaderboard: parseBooleanFlag(parseField(fields.hasLeaderboard), true),
    contestLive: parseField(fields.contestLive) === true,
    contestDurationDays: parseField(fields.contestDurationDays) as
      | Game["contestDurationDays"]
      | undefined,
    contestTask: parseField(fields.contestTask) as string | undefined,
    contestStartedAt: parseField(fields.contestStartedAt) as number | undefined,
    contestEndsAt: parseField(fields.contestEndsAt) as number | undefined,
    sortOrder: parseField(fields.sortOrder) as number | undefined,
    newArrivalAt: parseField(fields.newArrivalAt) as number | undefined,
    createdAt: Number(parseField(fields.createdAt) ?? 0),
  };
}

function gatingFlagsFromGame(game: Game): GameGatingFlags {
  return {
    active: game.active !== false,
    live: game.live !== false,
    hasLeaderboard: game.hasLeaderboard !== false,
    contestLive: game.contestLive === true,
    contestDurationDays: game.contestDurationDays,
    contestTask: game.contestTask,
    contestStartedAt: game.contestStartedAt,
    contestEndsAt: game.contestEndsAt,
  };
}

async function syncGatingAfterMutation(
  gameId: string,
  game?: Game | null
): Promise<void> {
  invalidateGameFlagsCache(gameId);
  if (!game) {
    try {
      await deleteGameGatingFlagsFromRtdb(gameId);
    } catch (err) {
      console.error(
        `[ArcadeX][GATING_SYNC] Failed to delete RTDB flags for ${gameId}:`,
        err instanceof Error ? err.message : err
      );
    }
    return;
  }
  try {
    await syncGameGatingFlagsToRtdb(gameId, gatingFlagsFromGame(game));
  } catch (err) {
    console.error(
      `[ArcadeX][GATING_SYNC] Firestore ok but RTDB sync failed for ${gameId}:`,
      err instanceof Error ? err.message : err
    );
  }
}

async function firestoreFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  if (isFirestoreCircuitOpen()) {
    return new Response(
      JSON.stringify({
        error: {
          code: 503,
          message: "Firestore temporarily unavailable (circuit open).",
          status: "UNAVAILABLE",
        },
      }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  const { projectId } = getServiceAccount();
  const token = await getFirebaseAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`;

  const res = await fetchWithTimeout(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (res.ok) {
    recordFirestoreSuccess();
  } else if (res.status === 429 || res.status >= 500) {
    recordFirestoreFailure(res.status);
  }

  return res;
}

async function listDocuments(path: string): Promise<FirestoreDocument[]> {
  const res = await firestoreFetch(path);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore request failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { documents?: FirestoreDocument[] };
  const docs = data.documents ?? [];
  // Firestore bills one read per document returned by a list.
  noteFirestoreReads(Math.max(docs.length, 1));
  return docs;
}

function encodeFields(
  data: Record<string, string | number | boolean>
): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string") fields[key] = { stringValue: value };
    else if (typeof value === "boolean") fields[key] = { booleanValue: value };
    else if (Number.isInteger(value)) fields[key] = { integerValue: String(value) };
    else fields[key] = { doubleValue: value };
  }
  return fields;
}

async function fetchGamesFromFirestore(): Promise<Game[]> {
  const docs = await listDocuments("games");
  return sortGames(docs.map(docToGame));
}

/**
 * Admin / mutations / reconcile — full catalog including hidden + test.
 * Does **not** treat public KV as a full-list source (that snapshot is filtered).
 *
 * Order: memory full → Firestore list → memory + public KV write.
 */
export async function fetchAllGamesFromServer(): Promise<Game[]> {
  await refreshCatalogCacheIfStale();
  const cached = getCachedFullGameList();
  if (cached) return cached;

  if (isFirestoreCircuitOpen()) {
    const stale = getStaleFullGameListFallback();
    if (stale) return stale;
  }

  if (gamesListInFlight && gamesListInFlightEpoch === getCatalogEpoch()) {
    return gamesListInFlight;
  }

  const epoch = getCatalogEpoch();
  gamesListInFlightEpoch = epoch;
  gamesListInFlight = (async () => {
    try {
      const games = await fetchGamesFromFirestore();
      if (epoch === getCatalogEpoch()) {
        // Miss path: publish public KV so home warms without a second list.
        setCachedFullGameList(games, true);
      }
      return games;
    } catch (err) {
      const stale = getStaleFullGameListFallback();
      if (stale) return stale;
      throw err;
    } finally {
      if (gamesListInFlightEpoch === epoch) {
        gamesListInFlight = null;
      }
    }
  })();

  return gamesListInFlight;
}

/** @deprecated Prefer fetchAllGamesFromServer or fetchPublicCatalogFromServer. */
export async function fetchGamesFromServer(): Promise<Game[]> {
  return fetchAllGamesFromServer();
}

/**
 * MiniPay home / public arcade — live + Coming Soon only.
 *
 * Order: memory public → **KV public** → Firestore list → write KV public.
 */
export async function fetchPublicCatalogFromServer(): Promise<PublicCatalogSnapshot> {
  await refreshCatalogCacheIfStale();

  const memPublic = getCachedPublicGameList();
  if (memPublic) {
    return { games: memPublic, testGameId: getCachedTestGameId() };
  }

  const shared = await readSharedPublicCatalog();
  if (shared) {
    return warmPublicCatalogMemory(shared);
  }

  if (isFirestoreCircuitOpen()) {
    const stale = getStalePublicGameListFallback();
    if (stale) {
      return { games: stale, testGameId: getCachedTestGameId() };
    }
  }

  if (
    publicCatalogInFlight &&
    publicCatalogInFlightEpoch === getCatalogEpoch()
  ) {
    return publicCatalogInFlight;
  }

  const epoch = getCatalogEpoch();
  publicCatalogInFlightEpoch = epoch;
  publicCatalogInFlight = (async () => {
    try {
      const games = await fetchGamesFromFirestore();
      if (epoch === getCatalogEpoch()) {
        return setCachedFullGameList(games, true);
      }
      return publicCatalogFromFull(games);
    } catch (err) {
      const stale = getStalePublicGameListFallback();
      if (stale) {
        return { games: stale, testGameId: getCachedTestGameId() };
      }
      throw err;
    } finally {
      if (publicCatalogInFlightEpoch === epoch) {
        publicCatalogInFlight = null;
      }
    }
  })();

  return publicCatalogInFlight;
}

async function fetchGameFromFirestore(id: string): Promise<Game | null> {
  const res = await firestoreFetch(`games/${id}`);
  if (res.status === 404) {
    noteFirestoreReads(1);
    return null;
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore request failed (${res.status}): ${text}`);
  }

  noteFirestoreReads(1);
  return docToGame((await res.json()) as FirestoreDocument);
}

export async function fetchGameFromServer(id: string): Promise<Game | null> {
  await refreshCatalogCacheIfStale();
  const cached = getCachedGameDoc(id);
  if (cached) return cached;

  if (isFirestoreCircuitOpen()) {
    return getStaleGameDocFallback(id);
  }

  try {
    const game = await fetchGameFromFirestore(id);
    if (game) setCachedGameDoc(id, game);
    return game;
  } catch (err) {
    const stale = getStaleGameDocFallback(id);
    if (stale) return stale;
    throw err;
  }
}

/**
 * After create / update / delete / reorder: one Firestore list, bump gen,
 * write public KV so other devices see Hide / Go-live without a home stampede.
 */
async function republishAfterMutation(): Promise<Game[]> {
  const games = await fetchGamesFromFirestore();
  await republishCatalogSnapshot(games);
  return games;
}

export async function createGameOnServer(
  data: Omit<Game, "id" | "createdAt">
): Promise<string> {
  const existing = await fetchAllGamesFromServer();
  // New games go to the top of the arcade order.
  const sortOrder = data.sortOrder ?? prependGameSortOrder(existing);
  const now = Date.now();

  let payload: Omit<Game, "id" | "createdAt"> = { ...data, sortOrder };
  if (payload.isTest === true) {
    payload = { ...payload, active: true, live: true };
    await clearTestFlagOnOtherGames(existing, null);
  }
  // Stamp New Arrival when created already live (Coming Soon waits until go-live).
  if (payload.live !== false && typeof payload.newArrivalAt !== "number") {
    payload = { ...payload, newArrivalAt: now };
  }

  const res = await firestoreFetch("games", {
    method: "POST",
    body: JSON.stringify({
      fields: encodeFields({ ...payload, createdAt: now }),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore create failed (${res.status}): ${text}`);
  }

  const doc = (await res.json()) as FirestoreDocument;
  const id = doc.name.split("/").pop() ?? "";
  const game = docToGame(doc);

  await syncGatingAfterMutation(id, game);
  await republishAfterMutation();

  return id;
}

async function clearTestFlagOnOtherGames(
  games: Game[],
  keepId: string | null
): Promise<void> {
  const others = games.filter(
    (g) => g.isTest === true && (keepId === null || g.id !== keepId)
  );
  for (const other of others) {
    await patchGameOnFirestore(other.id, { isTest: false });
  }
}

export async function updateGameOnServer(
  id: string,
  data: Partial<Omit<Game, "id">>
): Promise<void> {
  let patch = { ...data };
  const existing =
    patch.live !== undefined || patch.isTest === true
      ? await fetchGameFromFirestore(id)
      : null;

  if (patch.isTest === true) {
    const games = await fetchAllGamesFromServer();
    await clearTestFlagOnOtherGames(games, id);
    patch = { ...patch, active: true, live: true };
  }

  // New Arrival: Coming Soon → live (or first live via isTest force).
  const becomingLive =
    patch.live === true &&
    existing != null &&
    existing.live === false;
  const forcedLiveFromTest =
    patch.isTest === true &&
    existing != null &&
    existing.live === false;
  if (
    (becomingLive || forcedLiveFromTest) &&
    typeof patch.newArrivalAt !== "number"
  ) {
    const games = await fetchAllGamesFromServer();
    patch = {
      ...patch,
      newArrivalAt: Date.now(),
      sortOrder: prependGameSortOrder(games.filter((g) => g.id !== id)),
    };
  }

  await patchGameOnFirestore(id, patch);
  const games = await republishAfterMutation();
  const refreshed = games.find((g) => g.id === id) ?? null;
  await syncGatingAfterMutation(id, refreshed);
}

async function patchGameOnFirestore(
  id: string,
  data: Partial<Omit<Game, "id">>
): Promise<void> {
  const payload = Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined)
  ) as Record<string, string | number | boolean>;
  const keys = Object.keys(payload);
  if (keys.length === 0) return;

  const mask = keys.map((key) => `updateMask.fieldPaths=${key}`).join("&");
  const res = await firestoreFetch(`games/${id}?${mask}`, {
    method: "PATCH",
    body: JSON.stringify({
      fields: encodeFields(payload),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore update failed (${res.status}): ${text}`);
  }
}

export async function reorderGamesOnServer(orderedIds: string[]): Promise<void> {
  const games = await fetchAllGamesFromServer();
  const idSet = new Set(orderedIds);
  if (orderedIds.length !== games.length || games.some((g) => !idSet.has(g.id))) {
    throw new Error("Order must include every game exactly once.");
  }

  const currentOrder = new Map(
    games.map((game) => [game.id, game.sortOrder ?? 0])
  );

  const updates = orderedIds
    .map((id, index) => ({ id, sortOrder: index }))
    .filter(({ id, sortOrder }) => currentOrder.get(id) !== sortOrder);

  if (updates.length === 0) return;

  await Promise.all(
    updates.map(({ id, sortOrder }) =>
      patchGameOnFirestore(id, { sortOrder })
    )
  );

  await republishAfterMutation();
}

export async function deleteGameOnServer(id: string): Promise<void> {
  const res = await firestoreFetch(`games/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Firestore delete failed (${res.status}): ${text}`);
  }

  removeCachedGame(id);
  await syncGatingAfterMutation(id, null);
  await republishAfterMutation();
}

// Re-export project id helper for other modules.
export { getProjectId };
