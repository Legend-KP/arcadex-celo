/**
 * Lightweight registry so promos never open on top of other full-screen panels.
 * Any overlay claims an id while open; PromoPopupHost waits until none remain.
 */

type Listener = () => void;

const overlays = new Set<string>();
const listeners = new Set<Listener>();

function notify(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // Ignore listener errors
    }
  }
}

/** Claim an overlay while open. Returns a release function. */
export function claimUiOverlay(id: string): () => void {
  overlays.add(id);
  notify();
  return () => {
    if (!overlays.has(id)) return;
    overlays.delete(id);
    notify();
  };
}

export function hasUiOverlay(): boolean {
  return overlays.size > 0;
}

export function subscribeUiOverlays(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Known portal backdrops that must never share the screen with a promo. */
const BLOCKING_BACKDROP_SELECTOR = [
  ".player-modal-backdrop",
  ".onboarding-backdrop",
  ".spark-panel-backdrop",
  ".spark-success-backdrop",
  ".test-access-backdrop",
  ".lb-backdrop",
  ".exit-modal-backdrop",
  ".no-sparks-backdrop",
  ".game-tutorial-backdrop",
  ".admin-modal-backdrop",
].join(",");

/** DOM fallback for overlays that forgot to claim the registry. */
export function hasDomBlockingOverlay(): boolean {
  if (typeof document === "undefined") return true;
  return Boolean(document.querySelector(BLOCKING_BACKDROP_SELECTOR));
}

export function isPromoUiBusy(): boolean {
  return hasUiOverlay() || hasDomBlockingOverlay();
}

const PROMO_SESSION_KEY = "arcadex_promo_session_shown_v1";

/** Survives Home remounts within the same tab / MiniPay session. */
export function hasPromoBeenShownThisSession(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.sessionStorage.getItem(PROMO_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function markPromoShownThisSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PROMO_SESSION_KEY, "1");
  } catch {
    // private mode
  }
}
