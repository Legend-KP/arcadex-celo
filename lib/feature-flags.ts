/**
 * Product feature gates. Keep streak / Daily XP code paths intact —
 * these only hide UI and skip auto check-in / auto onboarding.
 */

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "1" || raw === "true" || raw === "on" || raw === "yes") {
    return true;
  }
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") {
    return false;
  }
  return fallback;
}

/** Daily Streak / shuffle / broken-streak / streak USDT claim UI + auto check-in. */
export function isDailyStreakUiEnabled(): boolean {
  return envFlag("NEXT_PUBLIC_DAILY_STREAK_UI_ENABLED", false);
}

/** Daily XP banner, board, and promo popup. */
export function isDailyXpUiEnabled(): boolean {
  return envFlag("NEXT_PUBLIC_DAILY_XP_UI_ENABLED", false);
}

/** Auto-open first-time onboarding slides (side-panel Tutorial still works). */
export function isAutoOnboardingEnabled(): boolean {
  return envFlag("NEXT_PUBLIC_AUTO_ONBOARDING_ENABLED", false);
}

/** Per-game $0.12 USDT open claim (on-chain spin+claim). */
export function isGameOpenClaimEnabled(): boolean {
  return envFlag("NEXT_PUBLIC_GAME_OPEN_CLAIM_ENABLED", true);
}
