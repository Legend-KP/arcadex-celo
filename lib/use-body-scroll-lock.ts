"use client";

import { useEffect } from "react";

/**
 * Several overlays used to set `document.body.style.overflow = "hidden"` and
 * restore whatever value they saw when they opened. If two overlays overlapped
 * (daily earn + promo, tutorial + contest poster, spark panel + a popup) the
 * one that closed last wrote "hidden" back and the menu could never scroll.
 *
 * A single counter avoids that. Inline overflow is cleared only when nothing
 * is still open.
 */
let locks = 0;
/** Set when leaving a game so the next full unlock also wakes the WebView. */
let thawOnNextUnlock = false;

function clearDocumentScrollStyles(): void {
  const html = document.documentElement;
  const body = document.body;
  html.style.overflow = "";
  body.style.overflow = "";
  html.style.position = "";
  body.style.position = "";
  html.style.top = "";
  body.style.top = "";
  html.style.left = "";
  body.style.left = "";
  html.style.right = "";
  body.style.right = "";
  html.style.width = "";
  body.style.width = "";
  html.style.height = "";
  body.style.height = "";
  html.style.touchAction = "";
  body.style.touchAction = "";
}

function applyLock(): void {
  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";
}

/**
 * MiniPay's WebView often keeps the touch target on a game iframe after it is
 * removed. Toggling overflow forces it to rebuild the page as scrollable.
 */
function thawWebViewScroll(): void {
  const body = document.body;
  const y = window.scrollY;
  body.style.overflow = "hidden";
  void body.offsetHeight;
  body.style.overflow = "";
  if (window.scrollY !== y) window.scrollTo(0, y);
}

function unlockDocument(): void {
  clearDocumentScrollStyles();
  if (!thawOnNextUnlock) return;
  thawOnNextUnlock = false;
  thawWebViewScroll();
}

export function releaseStuckDocumentScroll(options?: { thaw?: boolean }): void {
  if (typeof document === "undefined") return;
  if (options?.thaw) thawOnNextUnlock = true;
  if (locks > 0) return;
  unlockDocument();
}

export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    locks += 1;
    if (locks === 1) applyLock();
    return () => {
      locks = Math.max(0, locks - 1);
      if (locks === 0) unlockDocument();
    };
  }, [active]);
}
