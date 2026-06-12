export interface GameIframeUrlOptions {
  gameId: string;
  wallet?: string;
  playerName?: string;
  hasLeaderboard: boolean;
}

/**
 * Append shell params so Unity can HTTP-fetch progress from the parent origin
 * when postMessage is dropped on cold open.
 */
export function buildGameIframeUrl(
  baseUrl: string,
  opts: GameIframeUrlOptions
): string {
  const url = new URL(baseUrl);
  url.searchParams.set("arcadexGameId", opts.gameId);
  url.searchParams.set("arcadexShell", "1");
  if (opts.wallet) {
    url.searchParams.set("arcadexWallet", opts.wallet);
  }
  if (opts.playerName) {
    url.searchParams.set("arcadexPlayer", opts.playerName);
  }
  url.searchParams.set(
    "arcadexHasLeaderboard",
    opts.hasLeaderboard ? "1" : "0"
  );
  return url.toString();
}
