"use client";

import { useEffect } from "react";
import { playTouchSfx, preloadSfx } from "@/lib/sfx";

function isGameSurface(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest("iframe, canvas, .iframe-wrap, [data-no-touch-sfx]")
  );
}

/** Plays the touch clip on every tap in the ArcadeX shell, except in-game canvases. */
export default function TouchSfxListener() {
  useEffect(() => {
    preloadSfx();

    function onPointerDown(event: PointerEvent) {
      if (event.isPrimary === false) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (isGameSurface(event.target)) return;
      playTouchSfx();
    }

    document.addEventListener("pointerdown", onPointerDown, {
      capture: true,
      passive: true,
    });

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, []);

  return null;
}
