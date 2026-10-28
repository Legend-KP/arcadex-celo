"use client";

import { useEffect, useMemo, useState } from "react";
import { isGameOpenClaimEnabled } from "@/lib/feature-flags";
import {
  fetchGameOpenClaimDay,
  fetchGameOpenClaimStatus,
} from "@/lib/game-open-claim-client";
import type { Game } from "@/types";
import { gameIsLive } from "@/types";

export type GameOpenClaimUiState = {
  /** Still claimable today. */
  claimable: boolean;
  /** Already claimed for the current UTC day. */
  claimed: boolean;
};

/**
 * Live-game claim map for home thumbnails: true = still claimable today.
 */
export function useGameOpenClaimMap(
  walletAddress: string,
  games: Game[]
): Record<string, boolean> {
  const details = useGameOpenClaimDetails(walletAddress, games);
  return useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const [id, row] of Object.entries(details.byId)) {
      if (row.claimable) out[id] = true;
    }
    return out;
  }, [details.byId]);
}

/**
 * Per live game: whether today's $0.012 open claim is still open.
 * `loaded` is true once the first fetch for this wallet + game list settles.
 */
export function useGameOpenClaimDetails(
  walletAddress: string,
  games: Game[]
): {
  byId: Record<string, GameOpenClaimUiState>;
  loaded: boolean;
  claimsOpen: boolean;
} {
  const [byId, setById] = useState<Record<string, GameOpenClaimUiState>>({});
  const [loaded, setLoaded] = useState(false);
  const [claimsOpen, setClaimsOpen] = useState(true);
  const liveKey = useMemo(
    () =>
      games
        .filter((g) => gameIsLive(g))
        .map((g) => `${g.id}\0${g.name}`)
        .join("|"),
    [games]
  );

  useEffect(() => {
    if (!isGameOpenClaimEnabled()) {
      setClaimsOpen(true);
      return;
    }
    let cancelled = false;
    void fetchGameOpenClaimDay()
      .then((day) => {
        if (!cancelled) setClaimsOpen(day.claimsOpen);
      })
      .catch(() => {
        if (!cancelled) setClaimsOpen(true);
      });
    return () => {
      cancelled = true;
    };
  }, [liveKey]);

  useEffect(() => {
    if (!isGameOpenClaimEnabled() || !liveKey) {
      setById({});
      setLoaded(true);
      return;
    }

    const live = liveKey.split("|").map((entry) => {
      const [id, name] = entry.split("\0");
      return { id, name };
    });

    // No wallet yet — tease Claim only while the UTC day is still open.
    if (!walletAddress) {
      setById(
        Object.fromEntries(
          live.map((g) => [g.id, { claimable: claimsOpen, claimed: false }])
        )
      );
      setLoaded(true);
      return;
    }

    let cancelled = false;
    setLoaded(false);

    async function load() {
      const entries = await Promise.all(
        live.map(async (game) => {
          try {
            const status = await fetchGameOpenClaimStatus(
              walletAddress,
              game.id,
              game.name
            );
            const dayOpen = claimsOpen && status.claimsOpen !== false;
            const claimable =
              dayOpen &&
              !status.claimed &&
              (status.canClaim ||
                status.payoutsEnabled ||
                status.campaignId != null);
            return [game.id, { claimable, claimed: status.claimed }] as const;
          } catch {
            // Optimistic while claims are open. A closed day stays on Start Game.
            return [game.id, { claimable: claimsOpen, claimed: false }] as const;
          }
        })
      );
      if (!cancelled) {
        setById(Object.fromEntries(entries));
        setLoaded(true);
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
  }, [walletAddress, liveKey, claimsOpen]);

  return { byId, loaded, claimsOpen };
}
