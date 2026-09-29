"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  gameAssetCandidates,
  gameFallbackCandidates,
  gameVideoSources,
  preloadGameMenuAssets,
} from "@/lib/game-assets";
import { formatPlayCount } from "@/lib/format-play-count";
import {
  Game,
  gameHasContestLive,
  gameIsLive,
  gameIsNewArrival,
} from "@/types";

interface GameCardProps {
  game: Game;
  playCount?: number;
  /** Eager-load above-the-fold thumbs; lazy-load the rest. */
  priority?: boolean;
}

export default function GameCard({
  game,
  playCount = 0,
  priority = false,
}: GameCardProps) {
  const isLive = gameIsLive(game);
  const contestLive = gameHasContestLive(game);
  const isNewArrival = gameIsNewArrival(game);

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
  const videoSources = useMemo(() => gameVideoSources(game), [game]);

  const [thumbIdx, setThumbIdx] = useState(0);
  const [logoIdx, setLogoIdx] = useState(0);
  const [fallbackIdx, setFallbackIdx] = useState(0);
  const [inView, setInView] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const thumbSrc = thumbCandidates[thumbIdx];
  const logoSrc = logoCandidates[logoIdx];
  const fallbackSrc = fallbackCandidates[fallbackIdx];
  const posterSrc = thumbSrc || logoSrc || fallbackSrc;

  const imgLoading = priority ? "eager" : "lazy";
  const imgPriority = priority ? ("high" as const) : ("auto" as const);

  const showVideo =
    isLive &&
    Boolean(videoSources) &&
    !videoFailed &&
    !reduceMotion &&
    inView;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduceMotion(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!videoSources || reduceMotion) return;
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        setInView(entry.isIntersecting);
      },
      { rootMargin: "100px", threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [videoSources, reduceMotion]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (showVideo) {
      video.play().catch(() => {
        /* Autoplay can fail on some WebViews — poster stays visible. */
      });
      return;
    }

    video.pause();
  }, [showVideo]);

  const warmMenu = () => {
    if (isLive) preloadGameMenuAssets(game, { includeTutorial: true });
  };

  const thumbContent = thumbSrc ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={thumbSrc}
      alt={game.name}
      className="thumb-img"
      loading={imgLoading}
      fetchPriority={imgPriority}
      decoding="async"
      onError={() => setThumbIdx((i) => i + 1)}
    />
  ) : logoSrc ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoSrc}
      alt={game.name}
      className="thumb-img"
      loading={imgLoading}
      fetchPriority={imgPriority}
      decoding="async"
      onError={() => setLogoIdx((i) => i + 1)}
    />
  ) : fallbackSrc ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={fallbackSrc}
      alt={game.name}
      className="thumb-img"
      loading={imgLoading}
      fetchPriority={imgPriority}
      decoding="async"
      onError={() => setFallbackIdx((i) => i + 1)}
    />
  ) : (
    <div className="thumb-placeholder" aria-hidden />
  );

  const cardBody = (
    <>
      <div className="thumb-wrap" ref={wrapRef}>
        {thumbContent}
        {showVideo && videoSources && (
          <video
            ref={videoRef}
            className="thumb-video"
            muted
            playsInline
            loop
            preload={priority ? "metadata" : "none"}
            poster={posterSrc || undefined}
            aria-hidden
            onError={() => setVideoFailed(true)}
          >
            <source src={videoSources.webm} type="video/webm" />
            <source src={videoSources.mp4} type="video/mp4" />
          </video>
        )}
        {isNewArrival && (
          <span className="game-card-new-badge" aria-label="New arrival">
            NEW ARRIVAL
          </span>
        )}
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
        <p className="card-plays">
          {formatPlayCount(playCount)}{" "}
          {playCount === 1 ? "play" : "plays"}
        </p>
      </div>
    </>
  );

  const cardClass = [
    "game-card",
    !isLive && "game-card--coming-soon",
    contestLive && "game-card--contest-live",
    isNewArrival && "game-card--new-arrival",
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
