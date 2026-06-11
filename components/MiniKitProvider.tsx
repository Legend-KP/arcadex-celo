"use client";

import { ReactNode, useEffect, useRef } from "react";
import { tryInstallMiniKit } from "@/lib/walletAuth";
import { getWorldAppPublicConfig } from "@/lib/world-app-config";

const POLL_MS = 200;
const MAX_WAIT_MS = 15000;

/** Call MiniKit.install() once when World App injects its bridge. */
export default function MiniKitProvider({ children }: { children: ReactNode }) {
  const installedRef = useRef(false);

  useEffect(() => {
    const appId = getWorldAppPublicConfig().appId;
    if (!appId) {
      console.warn("World App ID is not configured (NEXT_PUBLIC_APP_ID).");
      return;
    }

    if (tryInstallMiniKit()) {
      installedRef.current = true;
      return;
    }

    const start = Date.now();

    const timer = window.setInterval(() => {
      if (installedRef.current || tryInstallMiniKit()) {
        installedRef.current = true;
        window.clearInterval(timer);
        return;
      }

      if (Date.now() - start >= MAX_WAIT_MS) {
        window.clearInterval(timer);
      }
    }, POLL_MS);

    return () => window.clearInterval(timer);
  }, []);

  return <>{children}</>;
}
