import { verifyAdminRequest } from "@/lib/admin-auth";
import {
  fetchAllGamesFromServer,
  fetchPublicCatalogFromServer,
} from "@/lib/firestore-server";
import { withFirestoreReadCounter } from "@/lib/firestore-read-counter";
import { fetchGamePlayCountsForIds } from "@/lib/player-backend";
import { Game } from "@/types";

export type CatalogListPayload = {
  games: Game[];
  playCounts: Record<string, number>;
  /** Id of the single test game, if any — not included in public `games`. */
  testGameId: string | null;
  firestoreReads: number;
  cacheHit: boolean;
};

export async function loadCatalogListForRequest(
  request: Request
): Promise<CatalogListPayload> {
  const isAdmin = await verifyAdminRequest(request);

  if (isAdmin) {
    const { result: games, firestoreReads } = await withFirestoreReadCounter(() =>
      fetchAllGamesFromServer()
    );
    const testGameId = games.find((g) => g.isTest === true)?.id ?? null;
    const visibleIds = games.map((g) => g.id);
    const allCounts = await fetchGamePlayCountsForIds(visibleIds).catch(
      () => ({}) as Record<string, number>
    );
    const playCounts = Object.fromEntries(
      visibleIds.map((id) => [
        id,
        typeof allCounts[id] === "number" ? allCounts[id] : 0,
      ])
    );

    return {
      games,
      playCounts,
      testGameId,
      firestoreReads,
      cacheHit: firestoreReads === 0,
    };
  }

  const { result: catalog, firestoreReads } = await withFirestoreReadCounter(() =>
    fetchPublicCatalogFromServer()
  );
  const visibleIds = catalog.games.map((g) => g.id);
  const allCounts = await fetchGamePlayCountsForIds(visibleIds).catch(
    () => ({}) as Record<string, number>
  );
  const playCounts = Object.fromEntries(
    visibleIds.map((id) => [
      id,
      typeof allCounts[id] === "number" ? allCounts[id] : 0,
    ])
  );

  return {
    games: catalog.games,
    playCounts,
    testGameId: catalog.testGameId,
    firestoreReads,
    cacheHit: firestoreReads === 0,
  };
}
