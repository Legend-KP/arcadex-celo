"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  gameAssetCandidates,
  gameFallbackCandidates,
  preloadGameMenuAssets,
} from "@/lib/game-assets";
import { formatContestCountdown } from "@/lib/contest";
import { formatPlayCount } from "@/lib/format-play-count";
import { Game, gameHasContestLive, gameIsLive } from "@/types";

export type GameCardVariant = "catalog" | "square";

interface GameCardProps {
  game: Game;
  playCount?: number;
  /** Eager-load above-the-fold thumbs; lazy-load the rest. */
  priority?: boolean;
  /** catalog = 2:3 thumbnail; square = 1:1 logo. */
  variant?: GameCardVariant;
  /** Optional last-played label for Continue Playing. */
  subtitle?: string;
  showContestTimer?: boolean;
}

function useContestRemaining(endsAt: number | undefined, enabled: boolean) {
  const [remaining, setRemaining] = useState(() =>
    enabled && typeof endsAt === "number" ? Math.max(0, endsAt - Date.now()) : 0
  );

  useEffect(() => {
    if (!enabled || typeof endsAt !== "number") {
      setRemaining(0);
      return;
    }
    const tick = () => setRemaining(Math.max(0, endsAt - Date.now()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [endsAt, enabled]);

  return remaining;
}

export default function GameCard({
  game,
  playCount = 0,
  priority = false,
  variant = "catalog",
  subtitle,
  showContestTimer = false,
}: GameCardProps) {
  const isLive = gameIsLive(game);
  const contestLive = gameHasContestLive(game);
  const isSquare = variant === "square";
  const remainingMs = useContestRemaining(
    game.contestEndsAt,
    showContestTimer && contestLive
  );

  const thumbCandidates = useMemo(
    () => gameAssetCandidates(game, "thumbnail"),
    [game]
  );
  const logoCandidates = useMemo(
    () => gameAssetCandidates(game, "logo"),
    [game]
  );
  const fallbackCandidates = useMemo(
    () => gameFallbackCandidates(game),
    [game]
  );

  const [thumbIdx, setThumbIdx] = useState(0);
  const [logoIdx, setLogoIdx] = useState(0);
  const [fallbackIdx, setFallbackIdx] = useState(0);

  const thumbSrc = thumbCandidates[thumbIdx];
  const logoSrc = logoCandidates[logoIdx];
  const fallbackSrc = fallbackCandidates[fallbackIdx];

  const imgLoading = priority ? "eager" : "lazy";
  const imgPriority = priority ? ("high" as const) : ("auto" as const);

  const warmMenu = () => {
    if (isLive) preloadGameMenuAssets(game, { includeTutorial: true });
  };

  // Catalog (2:3): portrait thumbnails so art fills the frame.
  // Square rails (1:1): logo assets.
  const primarySrc = isSquare
    ? logoSrc || thumbSrc || fallbackSrc
    : thumbSrc || logoSrc || fallbackSrc;
  const onPrimaryError = () => {
    if (isSquare) {
      if (logoSrc) setLogoIdx((i) => i + 1);
      else if (thumbSrc) setThumbIdx((i) => i + 1);
      else setFallbackIdx((i) => i + 1);
    } else if (thumbSrc) {
      setThumbIdx((i) => i + 1);
    } else if (logoSrc) {
      setLogoIdx((i) => i + 1);
    } else {
      setFallbackIdx((i) => i + 1);
    }
  };

  const thumbContent = primarySrc ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={primarySrc}
      alt={game.name}
      className="thumb-img"
      loading={imgLoading}
      fetchPriority={imgPriority}
      decoding="async"
      onError={onPrimaryError}
    />
  ) : (
    <div className="thumb-placeholder" aria-hidden />
  );

  const metaLine = subtitle
    ? subtitle
    : showContestTimer && contestLive
      ? `${formatContestCountdown(remainingMs)} left`
      : `${formatPlayCount(playCount)} ${playCount === 1 ? "play" : "plays"}`;

  const cardBody = (
    <>
      <div className="thumb-wrap">
        {thumbContent}
        {contestLive && (
          <span className="game-card-contest-badge" aria-label="Contest live">
            CONTEST LIVE
          </span>
        )}
        {!isLive && (
          <div className="coming-soon-overlay" aria-hidden>
            <span>Coming Soon</span>
          </div>
        )}
      </div>

      <div className="card-info">
        <p className="card-title">{game.name}</p>
        <p className="card-plays">{metaLine}</p>
      </div>
    </>
  );

  const cardClass = [
    "game-card",
    isSquare && "game-card--square",
    !isLive && "game-card--coming-soon",
    contestLive && "game-card--contest-live",
  ]
    .filter(Boolean)
    .join(" ");

  if (!isLive) {
    return (
      <div className={cardClass} aria-label={`${game.name} — coming soon`}>
        {cardBody}
      </div>
    );
  }

  return (
    <Link
      href={`/game/${game.id}`}
      className={cardClass}
      prefetch={false}
      onPointerEnter={warmMenu}
      onTouchStart={warmMenu}
    >
      {cardBody}
    </Link>
  );
}
