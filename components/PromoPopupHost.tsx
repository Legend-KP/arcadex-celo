"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import LiveContestsModal from "@/components/LiveContestsModal";
import PromoPopupModal from "@/components/PromoPopupModal";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import { gameSquareImageCandidates } from "@/lib/game-assets";
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
  isForeignUiBusy,
  isPromoUiBusy,
  markPromoShownThisSession,
} from "@/lib/ui-overlay-gate";
import {
  useClaimUiOverlay,
  useForeignUiBusy,
} from "@/lib/use-ui-overlay-gate";
import { Game } from "@/types";

export const PROMO_POPUP_OVERLAY_ID = "promo-popup";

/** Wait for modal/name/overlay transitions to settle before showing a promo. */
const PROMO_OPEN_SETTLE_MS = 700;
/** Extra settle after claim / daily-earn panels so the handoff feels smooth. */
const PROMO_AFTER_CLAIM_SETTLE_MS = 450;
/** Only count toward daily/session after the promo has been stably visible. */
const PROMO_COMMIT_MS = 400;

interface PromoPopupHostProps {
  games: Game[];
  onOpenActivityBoard: () => void;
  /**
   * Hold promos while daily-earn claims are still loading/showing so the
   * contest popup never races or stacks with the claim flow.
   */
  holdOff?: boolean;
}

export default function PromoPopupHost({
  games,
  onOpenActivityBoard: _onOpenActivityBoard,
  holdOff = false,
}: PromoPopupHostProps) {
  const router = useRouter();
  const { criticalModalsBlocking } = usePlayerProfile();
  const foreignBusy = useForeignUiBusy(PROMO_POPUP_OVERLAY_ID);
  const gateBusy = criticalModalsBlocking || foreignBusy || holdOff;
  const wasBusyRef = useRef(gateBusy);

  const [active, setActive] = useState<PromoPopupCandidate | null>(null);
  const sessionConsumedRef = useRef(hasPromoBeenShownThisSession());
  const committedIdsRef = useRef<Set<string>>(new Set());
  const openTimerRef = useRef<number | null>(null);
  const commitTimerRef = useRef<number | null>(null);
  const gamesRef = useRef(games);
  gamesRef.current = games;

  // Claim while showing so daily-earn / claim popups never stack on top.
  useClaimUiOverlay(PROMO_POPUP_OVERLAY_ID, Boolean(active));

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
    const justFreed = wasBusyRef.current && !gateBusy;
    wasBusyRef.current = gateBusy;

    if (gateBusy) {
      clearOpenTimer();
      clearCommitTimer();
      // Interrupted by another panel — do not burn the session slot
      // unless we already committed a stable show.
      setActive(null);
      return;
    }

    if (sessionConsumedRef.current || active) return;

    clearOpenTimer();
    const settleMs = justFreed
      ? PROMO_OPEN_SETTLE_MS + PROMO_AFTER_CLAIM_SETTLE_MS
      : PROMO_OPEN_SETTLE_MS;

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
    }, settleMs);

    return clearOpenTimer;
  }, [gateBusy, games, active, clearOpenTimer, clearCommitTimer]);

  // Commit only after the promo stays visible without other overlays.
  useEffect(() => {
    clearCommitTimer();
    if (!active || gateBusy) return;

    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = null;
      if (!active || gateBusy) return;
      if (isForeignUiBusy(PROMO_POPUP_OVERLAY_ID)) {
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

  const imageCandidates = useMemo(() => {
    if (!activeGame) return [] as string[];
    return gameSquareImageCandidates(activeGame);
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

    if (item.kind === "newGame" && item.gameId) {
      router.push(`/game/${item.gameId}`);
      return;
    }
    // dailyXp / liveContests: dismiss only (Play Now handled per card).
  }, [active, finish, router]);

  const handleContestPlay = useCallback(
    (gameId: string) => {
      if (!active) return;
      finish(active, true);
      router.push(`/game/${gameId}`);
    },
    [active, finish, router]
  );

  if (!active) return null;
  // Keep rendering while our own claim is registered; only foreign busy clears active.
  if (gateBusy) return null;

  if (active.kind === "liveContests") {
    return (
      <LiveContestsModal
        open
        games={games}
        onDismiss={handleDismiss}
        onPlay={handleContestPlay}
      />
    );
  }

  return (
    <PromoPopupModal
      open
      item={active}
      imageCandidates={imageCandidates}
      accentColor={accentColor}
      onDismiss={handleDismiss}
      onPrimary={handlePrimary}
    />
  );
}
