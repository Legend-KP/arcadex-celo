"use client";

import { useEffect, useState } from "react";
import {
  claimUiOverlay,
  hasUiOverlay,
  subscribeUiOverlays,
} from "@/lib/ui-overlay-gate";

/** While `open` is true, register this overlay so promos stay suppressed. */
export function useClaimUiOverlay(id: string, open: boolean): void {
  useEffect(() => {
    if (!open) return;
    return claimUiOverlay(id);
  }, [id, open]);
}

/** True when any claimed overlay is currently open. */
export function useUiOverlayBusy(): boolean {
  const [busy, setBusy] = useState(() => hasUiOverlay());

  useEffect(() => {
    setBusy(hasUiOverlay());
    return subscribeUiOverlays(() => setBusy(hasUiOverlay()));
  }, []);

  return busy;
}
