import { nextGameSortOrder, sortGames } from "@/lib/game-sort";
import {
  getCachedGameDoc,
  getCachedGameList,
  getStaleGameDocFallback,
  getStaleGameListFallback,
  invalidateGameCache,
  isFirestoreCircuitOpen,
  recordFirestoreFailure,
  recordFirestoreSuccess,
  setCachedGameDoc,
  setCachedGameList,
} from "@/lib/game-cache";
import { invalidateGameFlagsCache } from "@/lib/rtdb-cache";
import {
  deleteGameGatingFlagsFromRtdb,
  syncGameGatingFlagsToRtdb,
} from "@/lib/rtdb-server";
import { Game, GameGatingFlags } from "@/types";
import { getFirebaseAccessToken, getProjectId, getServiceAccount } from "@/lib/firebase-admin";

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

function parseField(value: FirestoreValue | undefined): unknown {
  if (!value) return undefined;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  return undefined;
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
    fallbackImage: String(
      parseField(fields.fallbackImage) ?? parseField(fields.emoji) ?? ""
    ),
    active: parseField(fields.active) !== false,
    live: parseField(fields.live) !== false,
    hasLeaderboard: parseField(fields.hasLeaderboard) !== false,
    contestLive: parseField(fields.contestLive) === true,
    contestDurationDays: parseField(fields.contestDurationDays) as
      | Game["contestDurationDays"]
      | undefined,
    contestTask: parseField(fields.contestTask) as string | undefined,
    contestStartedAt: parseField(fields.contestStartedAt) as number | undefined,
    contestEndsAt: parseField(fields.contestEndsAt) as number | undefined,
    sortOrder: parseField(fields.sortOrder) as number | undefined,
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
    await deleteGameGatingFlagsFromRtdb(gameId).catch(() => {});
    return;
  }
  await syncGameGatingFlagsToRtdb(gameId, gatingFlagsFromGame(game)).catch(
    () => {}
  );
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

  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
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
  return data.documents ?? [];
}

function encodeFields(
  data: Record<string, string | number | boolean>
): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") fields[key] = { stringValue: value };
    else if (typeof value === "boolean") fields[key] = { booleanValue: value };
    else if (Number.isInteger(value)) fields[key] = { integerValue: String(value) };
    else fields[key] = { doubleValue: value };
  }
  return fields;
}

export function isGameVisible(game: Game): boolean {
  return game.active !== false;
}

async function fetchGamesFromFirestore(): Promise<Game[]> {
  const docs = await listDocuments("games");
  return sortGames(docs.map(docToGame));
}

export async function fetchGamesFromServer(): Promise<Game[]> {
  const cached = getCachedGameList();
  if (cached) return cached;

  if (isFirestoreCircuitOpen()) {
    const stale = getStaleGameListFallback();
    if (stale) return stale;
  }

  try {
    const games = await fetchGamesFromFirestore();
    setCachedGameList(games);
    return games;
  } catch (err) {
    const stale = getStaleGameListFallback();
    if (stale) return stale;
    throw err;
  }
}

async function fetchGameFromFirestore(id: string): Promise<Game | null> {
  const res = await firestoreFetch(`games/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore request failed (${res.status}): ${text}`);
  }

  return docToGame((await res.json()) as FirestoreDocument);
}

export async function fetchGameFromServer(id: string): Promise<Game | null> {
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

export async function createGameOnServer(
  data: Omit<Game, "id" | "createdAt">
): Promise<string> {
  const existing = await fetchGamesFromServer();
  const sortOrder = data.sortOrder ?? nextGameSortOrder(existing);

  const res = await firestoreFetch("games", {
    method: "POST",
    body: JSON.stringify({
      fields: encodeFields({ ...data, sortOrder, createdAt: Date.now() }),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore create failed (${res.status}): ${text}`);
  }

  const doc = (await res.json()) as FirestoreDocument;
  const id = doc.name.split("/").pop() ?? "";
  const game = docToGame(doc);

  invalidateGameCache(id);
  await syncGatingAfterMutation(id, game);

  return id;
}

export async function updateGameOnServer(
  id: string,
  data: Partial<Omit<Game, "id">>
): Promise<void> {
  await patchGameOnFirestore(id, data);
  invalidateGameCache(id);
  const refreshed = await fetchGameFromFirestore(id);
  if (refreshed) setCachedGameDoc(id, refreshed);
  await syncGatingAfterMutation(id, refreshed);
}

async function patchGameOnFirestore(
  id: string,
  data: Partial<Omit<Game, "id">>
): Promise<void> {
  const keys = Object.keys(data);
  if (keys.length === 0) return;

  const mask = keys.map((key) => `updateMask.fieldPaths=${key}`).join("&");
  const res = await firestoreFetch(`games/${id}?${mask}`, {
    method: "PATCH",
    body: JSON.stringify({
      fields: encodeFields(data as Record<string, string | number | boolean>),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore update failed (${res.status}): ${text}`);
  }
}

export async function reorderGamesOnServer(orderedIds: string[]): Promise<void> {
  const games = await fetchGamesFromServer();
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

  invalidateGameCache();
  const refreshed = await fetchGamesFromFirestore();
  setCachedGameList(refreshed);
}

export async function deleteGameOnServer(id: string): Promise<void> {
  const res = await firestoreFetch(`games/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Firestore delete failed (${res.status}): ${text}`);
  }

  invalidateGameCache(id);
  await syncGatingAfterMutation(id, null);
}

// Re-export project id helper for other modules.
export { getProjectId };
