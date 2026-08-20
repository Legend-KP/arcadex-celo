import { verifyAdminRequest } from "@/lib/admin-auth";
import { fetchGamesFromServer, isGameVisible } from "@/lib/firestore-server";
import { fetchGamePlayCountsForIds } from "@/lib/player-backend";
import { Game } from "@/types";

export type CatalogListPayload = {
  games: Game[];
  playCounts: Record<string, number>;
};

export async function loadCatalogListForRequest(
  request: Request
): Promise<CatalogListPayload> {
  const games = await fetchGamesFromServer();
  const playCounts = await fetchGamePlayCountsForIds(
    games.map((g) => g.id)
  ).catch(() => ({}) as Record<string, number>);

  const isAdmin = await verifyAdminRequest(request);
  const visible = isAdmin ? games : games.filter(isGameVisible);

  return { games: visible, playCounts };
}
