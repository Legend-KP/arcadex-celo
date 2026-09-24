/** Password required to open the admin-designated test game. */
export const TEST_GAME_PASSWORD = "AAKPRP";

const UNLOCK_KEY = "arcadex_test_game_unlock";

function canUseSessionStorage(): boolean {
  return typeof window !== "undefined" && typeof sessionStorage !== "undefined";
}

export function verifyTestGamePassword(password: string): boolean {
  return password.trim() === TEST_GAME_PASSWORD;
}

export function isTestGameUnlocked(gameId: string): boolean {
  if (!canUseSessionStorage() || !gameId) return false;
  try {
    return sessionStorage.getItem(UNLOCK_KEY) === gameId;
  } catch {
    return false;
  }
}

export function unlockTestGame(gameId: string): void {
  if (!canUseSessionStorage() || !gameId) return;
  try {
    sessionStorage.setItem(UNLOCK_KEY, gameId);
  } catch {
    // Private mode / quota — ignore; user will be prompted again.
  }
}
