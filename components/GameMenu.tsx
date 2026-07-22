"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  gameMenuBackgroundCandidates,
  gameMenuImageCandidates,
  getGameTutorialSeenKey,
  getGameTutorialUrl,
} from "@/lib/game-assets";
import { Game, gameHasContestLive, gameHasLeaderboard } from "@/types";

interface GameMenuProps {
  game: Game;
  /** Pre-decoded fallback/hero image — preferred over candidate cascade. */
  primaryImageSrc?: string | null;
  onStart: () => void | Promise<void>;
  onLeaderboard: () => void;
  starting?: boolean;
  sparkError?: string;
}

export default function GameMenu({
  game,
  primaryImageSrc = null,
  onStart,
  onLeaderboard,
  starting = false,
  sparkError,
}: GameMenuProps) {
  const router = useRouter();
  const contestLive = gameHasContestLive(game);

  const bgCandidates = useMemo(() => {
    const list = gameMenuBackgroundCandidates(game);
    if (primaryImageSrc) {
      return [primaryImageSrc, ...list.filter((u) => u !== primaryImageSrc)];
    }
    return list;
  }, [game, primaryImageSrc]);

  const logoCandidates = useMemo(() => {
    const list = gameMenuImageCandidates(game);
    if (primaryImageSrc) {
      return [primaryImageSrc, ...list.filter((u) => u !== primaryImageSrc)];
    }
    return list;
  }, [game, primaryImageSrc]);

  const tutorialSrc = useMemo(() => getGameTutorialUrl(game), [game]);
  const tutorialSeenKey = useMemo(() => getGameTutorialSeenKey(game), [game]);

  const [bgIdx, setBgIdx] = useState(0);
  const [logoIdx, setLogoIdx] = useState(0);
  const [tutorialOpen, setTutorialOpen] = useState(false);

  const bgSrc = bgCandidates[bgIdx];
  const menuImageSrc = logoCandidates[logoIdx];

  const dismissTutorial = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(tutorialSeenKey, "1");
    }
    setTutorialOpen(false);
  }, [tutorialSeenKey]);

  useEffect(() => {
    setBgIdx(0);
    setLogoIdx(0);
  }, [game.id, primaryImageSrc]);

  useEffect(() => {
    if (!tutorialSrc || typeof window === "undefined") {
      setTutorialOpen(false);
      return;
    }

    const seen = window.localStorage.getItem(tutorialSeenKey) === "1";
    setTutorialOpen(!seen);
  }, [tutorialSrc, tutorialSeenKey]);

  useEffect(() => {
    if (!tutorialOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") dismissTutorial();
    }

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [tutorialOpen, dismissTutorial]);

  const tutorialModal =
    tutorialOpen && tutorialSrc ? (
      <div className="game-tutorial-backdrop" role="presentation">
        <div
          className="game-tutorial"
          role="dialog"
          aria-modal="true"
          aria-label={`${game.name} tutorial`}
        >
          <div className="game-tutorial-media">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={tutorialSrc}
              alt={`${game.name} how to play`}
              className="game-tutorial-img"
              loading="eager"
              fetchPriority="high"
              decoding="async"
            />
          </div>
          <button
            type="button"
            className="game-tutorial-btn"
            onClick={dismissTutorial}
          >
            Let&apos;s Go
          </button>
        </div>
      </div>
    ) : null;

  return (
    <div className="game-menu">
      <div className="game-menu-bg">
        {bgSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bgSrc}
            alt=""
            className="game-menu-bg-img"
            loading="eager"
            fetchPriority="high"
            decoding="async"
            onError={() => setBgIdx((i) => i + 1)}
          />
        ) : (
          <div className="game-menu-bg-fallback" />
        )}
        <div className="game-menu-bg-overlay" />
      </div>

      <div className="game-menu-grid" aria-hidden />

      <button
        type="button"
        className="game-menu-back"
        onClick={() => router.push("/")}
        aria-label="Back to home"
      >
        ←
      </button>
      {tutorialSrc && (
        <button
          type="button"
          className="game-menu-info"
          onClick={() => setTutorialOpen(true)}
          aria-label="How to play"
        >
          <span className="game-menu-info__glyph" aria-hidden>
            i
          </span>
        </button>
      )}

      <div className="game-menu-stack">
        {contestLive && (
          <div className="game-menu-contest-stripe" aria-label="Contest is live">
            <div className="game-menu-contest-stripe-track">
              {Array.from({ length: 8 }, (_, i) => (
                <span key={i} aria-hidden={i > 0}>
                  Contest is Live
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="game-menu-card">
          <div className="game-menu-logo-wrap">
            {menuImageSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={menuImageSrc}
                alt={game.name}
                className="game-menu-logo"
                loading="eager"
                fetchPriority="high"
                decoding="async"
                onError={() => setLogoIdx((i) => i + 1)}
              />
            ) : (
              <span className="game-menu-logo-fallback" aria-hidden />
            )}
          </div>
        </div>

        <div className="game-menu-actions">
          <button
            type="button"
            className="game-menu-btn game-menu-btn--start"
            onClick={onStart}
            disabled={starting}
          >
            <span className="game-menu-btn__icon" aria-hidden>
              ▶
            </span>
            {starting ? "Starting..." : "Start Game"}
          </button>
          {sparkError && (
            <p className="game-menu-spark-error" role="alert">
              {sparkError}
            </p>
          )}
          {gameHasLeaderboard(game) && (
            <button
              type="button"
              className="game-menu-btn game-menu-btn--leaderboard"
              onClick={onLeaderboard}
            >
              <span className="game-menu-btn__icon" aria-hidden>
                🏆
              </span>
              Leaderboard
            </button>
          )}
        </div>
      </div>

      {typeof document !== "undefined"
        ? tutorialModal && createPortal(tutorialModal, document.body)
        : tutorialModal}
    </div>
  );
}
