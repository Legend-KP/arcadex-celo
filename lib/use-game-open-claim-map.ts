"use client";

import { useEffect, useMemo, useState } from "react";
import { isGameOpenClaimEnabled } from "@/lib/feature-flags";
import { fetchGameOpenClaimStatus } from "@/lib/game-open-claim-client";
import type { Game } from "@/types";
import { gameIsLive } from "@/types";

/**
 * Live-game claim map for home thumbnails: true = still claimable today.
 */
export function useGameOpenClaimMap(
  walletAddress: string,
  games: Game[]
): Record<string, boolean> {
  const [map, setMap] = useState<Record<string, boolean>>({});
  const liveKey = useMemo(
    () =>
      games
        .filter((g) => gameIsLive(g))
        .map((g) => `${g.id}\0${g.name}`)
        .join("|"),
    [games]
  );

  useEffect(() => {
    if (!isGameOpenClaimEnabled() || !liveKey) {
      setMap({});
      return;
    }

    const live = liveKey.split("|").map((entry) => {
      const [id, name] = entry.split("\0");
      return { id, name };
    });

    // No wallet yet — still tease Claim on every live thumb.
    if (!walletAddress) {
      setMap(Object.fromEntries(live.map((g) => [g.id, true])));
      return;
    }

    let cancelled = false;

    async function load() {
      const entries = await Promise.all(
        live.map(async (game) => {
          try {
            const status = await fetchGameOpenClaimStatus(
              walletAddress,
              game.id,
              game.name
            );
            const claimable =
              !status.claimed &&
              (status.canClaim ||
                status.payoutsEnabled ||
                status.campaignId != null);
            return [game.id, claimable] as const;
          } catch {
            // Optimistic: show Claim until we know otherwise.
            return [game.id, true] as const;
          }
        })
      );
      if (!cancelled) {
        setMap(Object.fromEntries(entries));
      }
    }

    void load();

    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [walletAddress, liveKey]);

  return map;
}
