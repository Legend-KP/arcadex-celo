import { verifyAdminRequest } from "@/lib/admin-auth";
import { fetchGamesFromServer } from "@/lib/firestore-server";
import { withFirestoreReadCounter } from "@/lib/firestore-read-counter";
import { publicCatalogFromFull } from "@/lib/game-visibility";
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
  const catalog = isAdmin
    ? {
        games,
        testGameId: games.find((g) => g.isTest === true)?.id ?? null,
      }
    : publicCatalogFromFull(games);
  const visible = catalog.games;

  const playCounts = await fetchGamePlayCountsForIds(
    visible.map((g) => g.id)
  ).catch(() => ({}) as Record<string, number>);

  return {
    games: visible,
    playCounts,
    testGameId: catalog.testGameId,
    firestoreReads,
    cacheHit: firestoreReads === 0,
  };
}
