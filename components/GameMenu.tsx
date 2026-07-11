"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  gameAssetCandidates,
  gameMenuImageCandidates,
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

  const thumbCandidates = useMemo(
    () => gameAssetCandidates(game, "thumbnail"),
    [game]
  );
  const logoCandidates = useMemo(
    () => gameMenuImageCandidates(game),
    [game]
  );

  const [thumbIdx, setThumbIdx] = useState(0);
  const [logoIdx, setLogoIdx] = useState(0);

  const thumbSrc = thumbCandidates[thumbIdx];
  const menuImageSrc = logoCandidates[logoIdx];

  return (
    <div className="game-menu">
      <div className="game-menu-bg">
        {thumbSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbSrc}
            alt=""
            className="game-menu-bg-img"
            onError={() => setThumbIdx((i) => i + 1)}
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
