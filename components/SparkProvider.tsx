"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { fetchSparkData, localSparkData, spendSpark } from "@/lib/spark-client";
import { computeSparkSnapshot, normalizeSparkState, coerceSparkState } from "@/lib/spark";
import { SparkSnapshot, StoredSparkState } from "@/types";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";

interface SparkContextValue {
  sparks: SparkSnapshot;
  loading: boolean;
  refresh: () => Promise<void>;
  spendForGame: () => Promise<boolean>;
}

const SparkContext = createContext<SparkContextValue | null>(null);

export function useSparks(): SparkContextValue {
  const ctx = useContext(SparkContext);
  if (!ctx) {
    throw new Error("useSparks must be used within SparkProvider");
  }
  return ctx;
}

export default function SparkProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { walletAddress, isReady } = usePlayerProfile();
  const [state, setState] = useState<StoredSparkState>(
    () => localSparkData().state
  );
  const [loading, setLoading] = useState(true);

  const sparks = useMemo(
    () => computeSparkSnapshot(state),
    [state]
  );

  const refresh = useCallback(async () => {
    if (!walletAddress) {
      setState(localSparkData().state);
      return;
    }

    const data = await fetchSparkData(walletAddress);
    setState(coerceSparkState(data.state));
  }, [walletAddress]);

  const spendForGame = useCallback(async (): Promise<boolean> => {
    if (!walletAddress) {
      throw new Error("Connect your wallet in MiniPay to play.");
    }

    const result = await spendSpark(walletAddress);
    setState(coerceSparkState(result.state));
    return result.spent;
  }, [walletAddress]);

  useEffect(() => {
    if (!isReady) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        if (!walletAddress) {
          if (!cancelled) setState(localSparkData().state);
          return;
        }
        const data = await fetchSparkData(walletAddress);
        if (!cancelled) setState(coerceSparkState(data.state));
      } catch {
        if (!cancelled) setState(localSparkData().state);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [isReady, walletAddress]);

  useEffect(() => {
    if (!isReady) return;

    const id = window.setInterval(() => {
      setState((prev) => normalizeSparkState(prev));
    }, 1000);

    return () => window.clearInterval(id);
  }, [isReady]);

  const value = useMemo(
    () => ({
      sparks,
      loading,
      refresh,
      spendForGame,
    }),
    [sparks, loading, refresh, spendForGame]
  );

  return (
    <SparkContext.Provider value={value}>{children}</SparkContext.Provider>
  );
}
