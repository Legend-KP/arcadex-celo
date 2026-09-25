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
  /** At most one promo per app open — blocks chaining after dismiss/CTA. */
  const sessionUsedRef = useRef(false);
  const presentedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (criticalModalsBlocking) {
      setActive(null);
      return;
    }
    if (sessionUsedRef.current || active) return;
    if (games.length === 0) return;

    const next = buildPromoQueue(games);
    const first = next[0] ?? null;
    if (first) {
      sessionUsedRef.current = true;
      setActive(first);
    }
  }, [criticalModalsBlocking, games, active]);

  useEffect(() => {
    if (!active) return;
    if (presentedIdsRef.current.has(active.id)) return;
    presentedIdsRef.current.add(active.id);
    recordPromoPresented(active.id);
  }, [active]);

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
      if (markPersistent && item.persistent) {
        markPromoEventRead(item.id);
      }
      sessionUsedRef.current = true;
      setActive(null);
    },
    []
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

  if (criticalModalsBlocking || !active) return null;

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
