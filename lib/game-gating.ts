import {
  fetchGameGatingFlagsFromRtdb,
  syncGameGatingFlagsToRtdb,
} from "@/lib/rtdb-server";
import { fetchGameFromServer } from "@/lib/firestore-server";
import { Game, GameGatingFlags } from "@/types";

function flagsFromGame(game: Game): GameGatingFlags {
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

/**
 * Hot-path gating: prefer RTDB mirror (zero Firestore). Fall back to cached
 * Firestore game doc and backfill RTDB on miss.
 */
export async function resolveGameGating(
  gameId: string
): Promise<GameGatingFlags | null> {
  const fromRtdb = await fetchGameGatingFlagsFromRtdb(gameId);
  if (fromRtdb) return fromRtdb;

  const game = await fetchGameFromServer(gameId);
  if (!game) return null;

  const flags = flagsFromGame(game);
  await syncGameGatingFlagsToRtdb(gameId, flags).catch(() => {
    // Backfill is best-effort; cached Firestore doc is still valid.
  });
  return flags;
}

export function isGameVisibleFromFlags(flags: GameGatingFlags): boolean {
  return flags.active !== false;
}

/** Minimal Game-shaped object for contest helpers from RTDB flags. */
export function gamePickFromGatingFlags(
  gameId: string,
  flags: GameGatingFlags
): Pick<
  Game,
  | "id"
  | "hasLeaderboard"
  | "contestLive"
  | "contestDurationDays"
  | "contestTask"
  | "contestStartedAt"
  | "contestEndsAt"
> {
  return {
    id: gameId,
    hasLeaderboard: flags.hasLeaderboard,
    contestLive: flags.contestLive,
    contestDurationDays: flags.contestDurationDays,
    contestTask: flags.contestTask,
    contestStartedAt: flags.contestStartedAt,
    contestEndsAt: flags.contestEndsAt,
  };
}
