"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  gameMenuBackgroundCandidates,
  gameMenuImageCandidates,
  preloadGameMenuAssets,
} from "@/lib/game-assets";
import { Game, gameHasContestLive, gameHasLeaderboard } from "@/types";

interface GameMenuProps {
  game: Game;
  onStart: () => void | Promise<void>;
  onLeaderboard: () => void;
  starting?: boolean;
  sparkError?: string;
}

export default function GameMenu({
  game,
  onStart,
  onLeaderboard,
  starting = false,
  sparkError,
}: GameMenuProps) {
  const router = useRouter();
  const contestLive = gameHasContestLive(game);

  const bgCandidates = useMemo(
    () => gameMenuBackgroundCandidates(game),
    [game]
  );
  const logoCandidates = useMemo(
    () => gameMenuImageCandidates(game),
    [game]
  );

  const [bgIdx, setBgIdx] = useState(0);
  const [logoIdx, setLogoIdx] = useState(0);

  const bgSrc = bgCandidates[bgIdx];
  const menuImageSrc = logoCandidates[logoIdx];

  useEffect(() => {
    preloadGameMenuAssets(game);
  }, [game]);

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
              <span className="game-menu-logo-fallback">🎮</span>
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
    </div>
  );
}
