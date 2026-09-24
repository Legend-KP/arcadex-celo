import { verifyAdminRequest } from "@/lib/admin-auth";
import {
  fetchGamesFromServer,
  isGameInPublicCatalog,
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
  const { result: games, firestoreReads } = await withFirestoreReadCounter(() =>
    fetchGamesFromServer()
  );

  const isAdmin = await verifyAdminRequest(request);
  const testGameId = games.find((g) => g.isTest === true)?.id ?? null;
  const visible = isAdmin ? games : games.filter(isGameInPublicCatalog);
  const visibleIds = visible.map((g) => g.id);

  // Prefer id-scoped fetch so an incomplete play-count cache cannot zero the grid.
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
    games: visible,
    playCounts,
    testGameId,
    firestoreReads,
    cacheHit: firestoreReads === 0,
  };
}
