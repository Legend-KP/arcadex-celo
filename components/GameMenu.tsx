"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { gameAssetCandidates, gameFallbackCandidates } from "@/lib/game-assets";
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
  const logoCandidates = useMemo(() => {
    const logos = gameAssetCandidates(game, "logo");
    const seen = new Set(logos);
    const thumbs = gameAssetCandidates(game, "thumbnail").filter((url) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    });
    return [...logos, ...thumbs];
  }, [game]);
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

      <div className="game-menu-card">
        {contestLive && (
          <div className="game-menu-contest-stripe" aria-label="Contest is live">
            <div className="game-menu-contest-stripe-track">
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} aria-hidden={i > 0}>
                  Contest is Live
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="game-menu-logo-wrap">
          {logoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoSrc}
              alt={game.name}
              className="game-menu-logo"
              onError={() => setLogoIdx((i) => i + 1)}
            />
          ) : fallbackSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={fallbackSrc}
              alt={game.name}
              className="game-menu-logo"
              onError={() => setFallbackIdx((i) => i + 1)}
            />
          ) : (
            <span className="game-menu-logo-fallback">🎮</span>
          )}
        </div>

        <h1 className="game-menu-title">{game.name}</h1>

        <div className="game-menu-actions">
          <button
            type="button"
            className="game-menu-btn game-menu-btn--start"
            onClick={onStart}
            disabled={starting}
          >
            {starting ? "Starting..." : "START"}
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
              Leaderboard
            </button>
          )}
          <button
            type="button"
            className="game-menu-btn game-menu-btn--back"
            onClick={() => router.push("/")}
          >
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
