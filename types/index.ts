export const LEADERBOARD_MAX_ENTRIES = 25;

export interface LeaderboardEntry {
  name: string;
  score: number;
  walletAddress?: string;
  createdAt?: number;
}

export interface PlayerProfile {
  id: string;
  name: string;
  walletAddress?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Game {
  id: string;
  name: string;
  thumbnail: string;   // image URL
  logo?: string;       // square 1:1 logo URL (menu screen)
  url: string;         // Unity WebGL URL
  plays: string;       // display string e.g. "1.2m"
  fallbackImage: string; // image URL when thumbnail/logo are missing
  active: boolean;
  /** When false, the game is visible but shows "Coming Soon" and cannot be played. Defaults to true. */
  live?: boolean;
  /** When false, leaderboard UI, RTDB paths, and score APIs are disabled. Defaults to true. */
  hasLeaderboard?: boolean;
  createdAt: number;
}

export function gameHasLeaderboard(game: Pick<Game, "hasLeaderboard">): boolean {
  return game.hasLeaderboard !== false;
}

export function gameIsLive(game: Pick<Game, "live">): boolean {
  return game.live !== false;
}

/**
 * Raw RTDB shape at `users/{wallet}/games/{gameId}`.
 * Score games store `s`; level games store `l`. No timestamp field.
 */
export interface StoredGameProgress {
  /** High score (when hasLeaderboard is true) */
  s?: number;
  /** Current level (when hasLeaderboard is false) */
  l?: number;
}

/** API / client-facing game progress */
export interface GameProgress {
  score?: number;
  level?: number;
}
