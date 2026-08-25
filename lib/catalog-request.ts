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
  const playCounts = await fetchGamePlayCountsForIds(
    games.map((g) => g.id)
  ).catch(() => ({}) as Record<string, number>);

  const isAdmin = await verifyAdminRequest(request);
  const visible = isAdmin ? games : games.filter(isGameVisible);

  return {
    games: visible,
    playCounts,
    firestoreReads,
    cacheHit: firestoreReads === 0,
  };
}
