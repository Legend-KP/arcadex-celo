"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PromoPopupModal from "@/components/PromoPopupModal";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import { getPrimaryGameMenuImage, gameAssetCandidates } from "@/lib/game-assets";
import {
  buildPromoQueue,
  type PromoPopupCandidate,
} from "@/lib/promo-popups";
import {
  markPromoEventRead,
  recordPromoPresented,
} from "@/lib/promo-popups-seen";
import { Game } from "@/types";

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
  const [active, setActive] = useState<PromoPopupCandidate | null>(null);
  const [tick, setTick] = useState(0);
  const presentedIdsRef = useRef<Set<string>>(new Set());

  // While idle, periodically re-evaluate milestones (contest/week clocks).
  useEffect(() => {
    if (criticalModalsBlocking || active) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, [criticalModalsBlocking, active]);

  useEffect(() => {
    if (criticalModalsBlocking) {
      setActive(null);
      return;
    }
    // Do not interrupt an open popup; after dismiss `active` is null and we pick next.
    if (active) return;
    if (games.length === 0) return;

    const next = buildPromoQueue(games);
    setActive(next[0] ?? null);
  }, [criticalModalsBlocking, games, active, tick]);

  useEffect(() => {
    if (!active) return;
    if (presentedIdsRef.current.has(active.id)) return;
    presentedIdsRef.current.add(active.id);
    recordPromoPresented(active.id);
  }, [active]);

  const imageUrl = useMemo(() => {
    if (!active?.gameId) return null;
    const game = games.find((g) => g.id === active.gameId);
    if (!game) return null;
    return gameAssetCandidates(game, "logo")[0] ?? getPrimaryGameMenuImage(game);
  }, [active, games]);

  const finish = useCallback((item: PromoPopupCandidate, markPersistent: boolean) => {
    if (markPersistent && item.persistent) {
      markPromoEventRead(item.id);
    }
    setActive(null);
  }, []);

  const handleDismiss = useCallback(() => {
    if (!active) return;
    finish(active, true);
  }, [active, finish]);

  const handlePrimary = useCallback(() => {
    if (!active) return;
    const item = active;
    finish(item, true);

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

  const handleCommunityCta = useCallback(() => {
    if (!active) return;
    finish(active, false);
  }, [active, finish]);

  if (criticalModalsBlocking || !active) return null;

  return (
    <PromoPopupModal
      open
      item={active}
      imageUrl={imageUrl}
      onDismiss={handleDismiss}
      onPrimary={handlePrimary}
      onOpenTelegram={handleCommunityCta}
      onOpenTwitter={handleCommunityCta}
    />
  );
}
