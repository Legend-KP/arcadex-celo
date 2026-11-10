"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { isGameOpenClaimEnabled } from "@/lib/feature-flags";
import {
  fetchGameOpenClaimDay,
  fetchGameOpenClaimStatuses,
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
 * Per live game: whether today's $0.01 open claim is still open.
 * `loaded` is true once the first fetch for this wallet + game list settles.
 */
export function useGameOpenClaimDetails(
  walletAddress: string,
  games: Game[]
): {
  byId: Record<string, GameOpenClaimUiState>;
  loaded: boolean;
  claimsOpen: boolean;
  /** False after this wallet reserved 8 slots today (same look as out-of-funds). */
  walletClaimsOpen: boolean;
} {
  const [byId, setById] = useState<Record<string, GameOpenClaimUiState>>({});
  const [loaded, setLoaded] = useState(false);
  const [claimsOpen, setClaimsOpen] = useState(true);
  const [walletClaimsOpen, setWalletClaimsOpen] = useState(true);
  const lastBatchAt = useRef(0);
  const claimsOpenRef = useRef(claimsOpen);
  claimsOpenRef.current = claimsOpen;
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
      setWalletClaimsOpen(true);
      return;
    }
    // Signed-in home gets claimsOpen from the batched status call.
    if (walletAddress) return;
    let cancelled = false;
    void fetchGameOpenClaimDay()
      .then((day) => {
        if (!cancelled) {
          setClaimsOpen(day.claimsOpen);
          setWalletClaimsOpen(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setClaimsOpen(true);
          setWalletClaimsOpen(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [liveKey, walletAddress]);

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
          live.map((g) => [
            g.id,
            { claimable: claimsOpenRef.current, claimed: false },
          ])
        )
      );
      setWalletClaimsOpen(true);
      setLoaded(true);
      return;
    }

    let cancelled = false;
    setLoaded(false);

    function applyBatch(
      rows: Awaited<ReturnType<typeof fetchGameOpenClaimStatuses>>
    ) {
      const dayOpen = rows.claimsOpen;
      const walletOpen = rows.walletClaimsOpen;
      const entries = live.map((game) => {
        const status = rows.byGameId[game.id];
        if (!status) {
          return [
            game.id,
            { claimable: dayOpen && walletOpen, claimed: false },
          ] as const;
        }
        // Match out-of-funds: only show Claim when the server says canClaim.
        const claimable =
          dayOpen &&
          status.claimsOpen !== false &&
          !status.claimed &&
          Boolean(status.canClaim);
        return [game.id, { claimable, claimed: status.claimed }] as const;
      });
      setClaimsOpen(dayOpen);
      setWalletClaimsOpen(walletOpen);
      setById(Object.fromEntries(entries));
      setLoaded(true);
    }

    async function load(force: boolean) {
      if (
        !force &&
        lastBatchAt.current > 0 &&
        Date.now() - lastBatchAt.current < 60_000
      ) {
        return;
      }
      lastBatchAt.current = Date.now();
      try {
        const rows = await fetchGameOpenClaimStatuses(walletAddress, live);
        if (!cancelled) applyBatch(rows);
      } catch {
        if (!cancelled) {
          setById(
            Object.fromEntries(
              live.map((game) => [
                game.id,
                { claimable: claimsOpenRef.current, claimed: false },
              ])
            )
          );
          setLoaded(true);
          lastBatchAt.current = 0;
        }
      }
    }

    void load(true);

    const onVisible = () => {
      if (document.visibilityState === "visible") void load(false);
    };
    const onClaimed = (event: Event) => {
      const gameId = (event as CustomEvent<{ gameId?: string }>).detail?.gameId;
      if (!gameId) return;
      setById((prev) => ({
        ...prev,
        [gameId]: { claimable: false, claimed: true },
      }));
      // After a claim, refetch so remaining games drop Claim at the wallet cap.
      lastBatchAt.current = 0;
      void load(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("arcadex:game-open-claimed", onClaimed);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("arcadex:game-open-claimed", onClaimed);
    };
  }, [walletAddress, liveKey]);

  useEffect(() => {
    if (walletAddress || !liveKey || !isGameOpenClaimEnabled()) return;
    const live = liveKey.split("|").map((entry) => entry.split("\0")[0]);
    setById(
      Object.fromEntries(
        live.map((id) => [id, { claimable: claimsOpen, claimed: false }])
      )
    );
  }, [walletAddress, liveKey, claimsOpen]);

  return { byId, loaded, claimsOpen, walletClaimsOpen };
}
