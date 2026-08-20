import {
  fetchGameGatingFlagsFromRtdb,
  syncGameGatingFlagsToRtdb,
} from "@/lib/player-backend";
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
 * Hot-path gating: prefer RTDB mirror, but always overlay catalog fields from
 * the Firestore game doc when available. RTDB flags often omit hasLeaderboard;
 * `undefined !== false` was defaulting those games to score mode (`s`), so
 * level games never wrote D1 column `l`.
 */
export async function resolveGameGating(
  gameId: string
): Promise<GameGatingFlags | null> {
  const [fromRtdb, game] = await Promise.all([
    fetchGameGatingFlagsFromRtdb(gameId),
    fetchGameFromServer(gameId).catch(() => null),
  ]);

  if (!fromRtdb && !game) return null;

  if (game) {
    const fromGame = flagsFromGame(game);
    const flags: GameGatingFlags = {
      ...(fromRtdb ?? fromGame),
      active: fromGame.active,
      live: fromGame.live,
      hasLeaderboard: fromGame.hasLeaderboard,
    };

    if (
      !fromRtdb ||
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

  return fromRtdb;
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
