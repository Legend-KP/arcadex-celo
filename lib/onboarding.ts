export const ONBOARDING_SEEN_KEY = "arcadex_onboarding_seen";

export const ONBOARDING_SLIDES = [
  "/onboarding/TUTORIAL-1.webp",
  "/onboarding/TUTORIAL-2.webp",
  "/onboarding/TUTORIAL-3.webp",
  "/onboarding/TUTORIAL-4.webp",
] as const;

export function hasSeenOnboarding(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(ONBOARDING_SEEN_KEY) === "1";
}

export function markOnboardingSeen(): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ONBOARDING_SEEN_KEY, "1");
}
