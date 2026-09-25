import {
  fetchGameGatingFlagsFromRtdb,
  syncGameGatingFlagsToRtdb,
} from "@/lib/player-backend";
import { getCachedGameDoc } from "@/lib/game-cache";
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
 * Hot-path gating for play / progress / state / leaderboard.
 *
 * Prefer the RTDB/D1 mirror (synced on admin catalog mutations). Hitting
 * Firestore on every request burned the free daily read quota even with a
 * tiny catalog — Cloudflare isolates are cold often, and Unity progress
 * storms amplify that.
 *
 * Firestore is only used when the mirror is missing (then we backfill).
 * If the in-memory catalog doc is already warm, overlay it at zero cost.
 */
export async function resolveGameGating(
  gameId: string
): Promise<GameGatingFlags | null> {
  const fromRtdb = await fetchGameGatingFlagsFromRtdb(gameId);

  if (fromRtdb) {
    const cached = getCachedGameDoc(gameId);
    if (!cached) return fromRtdb;

    const fromGame = flagsFromGame(cached);
    const flags: GameGatingFlags = {
      ...fromRtdb,
      active: fromGame.active,
      live: fromGame.live,
      hasLeaderboard: fromGame.hasLeaderboard,
    };

    if (
      fromRtdb.hasLeaderboard !== flags.hasLeaderboard ||
      fromRtdb.active !== flags.active ||
      fromRtdb.live !== flags.live
    ) {
      void syncGameGatingFlagsToRtdb(gameId, flags).catch(() => {
        // Backfill is best-effort.
      });
    }

    return flags;
  }

  const game = await fetchGameFromServer(gameId).catch(() => null);
  if (!game) return null;

  const flags = flagsFromGame(game);
  void syncGameGatingFlagsToRtdb(gameId, flags).catch(() => {
    // Backfill is best-effort.
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
