import { Game } from "@/types";

/** Reachable by id (test games stay password-gated in the UI). */
export function isGameVisible(game: Game): boolean {
  if (game.isTest === true) return true;
  return game.active !== false;
}

/**
 * Public home / arcade grid + shared KV snapshot.
 * Includes Coming Soon (`live === false`) while active; excludes hidden and test-only.
 */
export function isGameInPublicCatalog(game: Game): boolean {
  return game.active !== false && game.isTest !== true;
}

export function publicCatalogFromFull(games: Game[]): {
  games: Game[];
  testGameId: string | null;
} {
  return {
    games: games.filter(isGameInPublicCatalog),
    testGameId: games.find((g) => g.isTest === true)?.id ?? null,
  };
}
