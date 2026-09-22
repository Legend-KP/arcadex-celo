import { verifyAdminRequest } from "@/lib/admin-auth";
import { fetchGamesFromServer, isGameVisible } from "@/lib/firestore-server";
import { withFirestoreReadCounter } from "@/lib/firestore-read-counter";
import { fetchGamePlayCountsForIds } from "@/lib/player-backend";
import { Game } from "@/types";

export type CatalogListPayload = {
  games: Game[];
  playCounts: Record<string, number>;
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
  const visible = isAdmin ? games : games.filter(isGameVisible);
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
    firestoreReads,
    cacheHit: firestoreReads === 0,
  };
}
