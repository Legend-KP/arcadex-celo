"use client";

import { useEffect, useState } from "react";
import { getCachedWallet } from "@/lib/player-id";
import {
  readWalletImmediately,
  resolveWalletOnAppOpen,
} from "@/lib/walletAuth";

/** Wallet from React context, cache, or MiniPay provider. */
export function useResolvedWallet(contextWallet?: string): string {
  const [resolved, setResolved] = useState(() =>
    pickWallet(contextWallet)
  );

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      const immediate = pickWallet(contextWallet);
      if (immediate) {
        if (!cancelled) setResolved(immediate);
        return;
      }

      const fromProvider = await resolveWalletOnAppOpen();
      if (!cancelled && fromProvider) {
        setResolved(fromProvider);
      }
    }

    void resolve();
    return () => {
      cancelled = true;
    };
  }, [contextWallet]);

  return resolved;
}

function pickWallet(contextWallet?: string): string {
  if (contextWallet?.trim()) return contextWallet.trim();
  return readWalletImmediately() ?? getCachedWallet() ?? "";
}
