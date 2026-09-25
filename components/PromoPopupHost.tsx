"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PromoPopupModal from "@/components/PromoPopupModal";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import { getPrimaryGameMenuImage, gameAssetCandidates } from "@/lib/game-assets";
import { getGameTheme } from "@/lib/game-themes";
import {
  buildPromoQueue,
  isCommunityPromo,
  type PromoPopupCandidate,
} from "@/lib/promo-popups";
import {
  markPromoEventRead,
  recordPromoPresented,
} from "@/lib/promo-popups-seen";
import {
  hasPromoBeenShownThisSession,
  isPromoUiBusy,
  markPromoShownThisSession,
} from "@/lib/ui-overlay-gate";
import { useUiOverlayBusy } from "@/lib/use-ui-overlay-gate";
import { Game } from "@/types";

/** Wait for modal/name/overlay transitions to settle before showing a promo. */
const PROMO_OPEN_SETTLE_MS = 650;
/** Only count toward daily/session after the promo has been stably visible. */
const PROMO_COMMIT_MS = 400;

interface PromoPopupHostProps {
  games: Game[];
  onOpenActivityBoard: () => void;
}

export default function PromoPopupHost({
  games,
  onOpenActivityBoard,
}: PromoPopupHostProps) {
  const router = useRouter();
  const { criticalModalsBlocking } = usePlayerProfile();
  const overlayBusy = useUiOverlayBusy();
  const gateBusy = criticalModalsBlocking || overlayBusy;

  const [active, setActive] = useState<PromoPopupCandidate | null>(null);
  const sessionConsumedRef = useRef(hasPromoBeenShownThisSession());
  const committedIdsRef = useRef<Set<string>>(new Set());
  const openTimerRef = useRef<number | null>(null);
  const commitTimerRef = useRef<number | null>(null);
  const gamesRef = useRef(games);
  gamesRef.current = games;

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current != null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }, []);

  const clearCommitTimer = useCallback(() => {
    if (commitTimerRef.current != null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
  }, []);

  const consumeSession = useCallback(() => {
    sessionConsumedRef.current = true;
    markPromoShownThisSession();
  }, []);

  useEffect(() => {
    if (gateBusy) {
      clearOpenTimer();
      clearCommitTimer();
      // Interrupted by another panel — do not burn the session slot
      // unless we already committed a stable show.
      setActive(null);
      return;
    }

    if (sessionConsumedRef.current || active) return;
    if (gamesRef.current.length === 0) return;

    clearOpenTimer();
    openTimerRef.current = window.setTimeout(function tryOpen() {
      openTimerRef.current = null;
      if (sessionConsumedRef.current) return;
      // Final DOM check — covers panels that race the React registry.
      if (isPromoUiBusy()) {
        openTimerRef.current = window.setTimeout(tryOpen, 400);
        return;
      }
      const first = buildPromoQueue(gamesRef.current)[0] ?? null;
      if (first) setActive(first);
    }, PROMO_OPEN_SETTLE_MS);

    return clearOpenTimer;
  }, [gateBusy, games, active, clearOpenTimer, clearCommitTimer]);

  // Commit only after the promo stays visible without other overlays.
  useEffect(() => {
    clearCommitTimer();
    if (!active || gateBusy) return;

    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = null;
      if (!active || gateBusy) return;
      if (isPromoUiBusy()) {
        setActive(null);
        return;
      }
      if (!committedIdsRef.current.has(active.id)) {
        committedIdsRef.current.add(active.id);
        recordPromoPresented(active.id);
      }
      consumeSession();
    }, PROMO_COMMIT_MS);

    return clearCommitTimer;
  }, [active, gateBusy, clearCommitTimer, consumeSession]);

  const activeGame = useMemo(() => {
    if (!active?.gameId) return null;
    return games.find((g) => g.id === active.gameId) ?? null;
  }, [active, games]);

  const imageUrl = useMemo(() => {
    if (!activeGame) return null;
    return (
      gameAssetCandidates(activeGame, "logo")[0] ??
      getPrimaryGameMenuImage(activeGame)
    );
  }, [activeGame]);

  const accentColor = useMemo(() => {
    if (!activeGame) return null;
    return getGameTheme(activeGame).topbar;
  }, [activeGame]);

  const finish = useCallback(
    (item: PromoPopupCandidate, markPersistent: boolean) => {
      clearOpenTimer();
      clearCommitTimer();
      if (markPersistent && item.persistent) {
        markPromoEventRead(item.id);
      }
      if (!committedIdsRef.current.has(item.id)) {
        committedIdsRef.current.add(item.id);
        recordPromoPresented(item.id);
      }
      consumeSession();
      setActive(null);
    },
    [clearOpenTimer, clearCommitTimer, consumeSession]
  );

  const handleDismiss = useCallback(() => {
    if (!active) return;
    finish(active, true);
  }, [active, finish]);

  const handlePrimary = useCallback(() => {
    if (!active) return;
    const item = active;
    const community = isCommunityPromo(item.kind);
    finish(item, !community);

    if (
      (item.kind === "newGame" ||
        item.kind === "contestStart" ||
        item.kind === "contestEnd") &&
      item.gameId
    ) {
      router.push(`/game/${item.gameId}`);
      return;
    }
    if (item.kind === "weekStart" || item.kind === "weekEnd") {
      onOpenActivityBoard();
    }
  }, [active, finish, onOpenActivityBoard, router]);

  if (gateBusy || !active) return null;

  return (
    <PromoPopupModal
      open
      item={active}
      imageUrl={imageUrl}
      accentColor={accentColor}
      onDismiss={handleDismiss}
      onPrimary={handlePrimary}
    />
  );
}
