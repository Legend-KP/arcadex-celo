"use client";

import { useEffect, useState } from "react";
import {
  claimUiOverlay,
  hasUiOverlay,
  isForeignUiBusy,
  subscribeUiOverlays,
} from "@/lib/ui-overlay-gate";

/** While `open` is true, register this overlay so promos stay suppressed. */
export function useClaimUiOverlay(id: string, open: boolean): void {
  useEffect(() => {
    if (!open) return;
    return claimUiOverlay(id);
  }, [id, open]);
}

/** True when an overlay other than `selfId` is open. */
export function useForeignUiBusy(selfId: string): boolean {
  const [busy, setBusy] = useState(() =>
    typeof document === "undefined" ? false : isForeignUiBusy(selfId)
  );

  useEffect(() => {
    const read = () => setBusy(isForeignUiBusy(selfId));
    read();
    return subscribeUiOverlays(read);
  }, [selfId]);

  return busy;
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
