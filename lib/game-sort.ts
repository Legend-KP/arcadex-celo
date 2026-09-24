import { Game, gameIsNewArrival } from "@/types";

/** Lower sortOrder appears first; missing sortOrder falls back to createdAt (newest first). */
export function compareGames(a: Game, b: Game): number {
  // Active new arrivals stay at the front for their 4-day window.
  const aNew = gameIsNewArrival(a);
  const bNew = gameIsNewArrival(b);
  if (aNew !== bNew) return aNew ? -1 : 1;
  if (aNew && bNew) {
    const aAt = a.newArrivalAt ?? 0;
    const bAt = b.newArrivalAt ?? 0;
    if (aAt !== bAt) return bAt - aAt;
  }

  const orderA = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
  const orderB = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
  if (orderA !== orderB) return orderA - orderB;
  return (b.createdAt ?? 0) - (a.createdAt ?? 0);
}

export function sortGames(games: Game[]): Game[] {
  return [...games].sort(compareGames);
}

/** Append after the current last game (legacy / explicit reorder). */
export function nextGameSortOrder(games: Game[]): number {
  const maxOrder = games.reduce(
    (max, game) => Math.max(max, game.sortOrder ?? -1),
    -1
  );
  return maxOrder + 1;
}

/** Place a newly added game at the front of the home grid. */
export function prependGameSortOrder(games: Game[]): number {
  const minOrder = games.reduce(
    (min, game) => Math.min(min, game.sortOrder ?? Number.MAX_SAFE_INTEGER),
    Number.MAX_SAFE_INTEGER
  );
  if (minOrder === Number.MAX_SAFE_INTEGER) return 0;
  return minOrder - 1;
}
