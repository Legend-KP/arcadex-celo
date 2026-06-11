"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { gameAssetCandidates } from "@/lib/game-assets";
import { Game, gameHasLeaderboard } from "@/types";

interface GameMenuProps {
  game: Game;
  onStart: () => void;
  onLeaderboard: () => void;
}

export default function GameMenu({ game, onStart, onLeaderboard }: GameMenuProps) {
  const router = useRouter();

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

  const [thumbIdx, setThumbIdx] = useState(0);
  const [logoIdx, setLogoIdx] = useState(0);

  const thumbSrc = thumbCandidates[thumbIdx];
  const logoSrc = logoCandidates[logoIdx];

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
        <div className="game-menu-logo-wrap">
          {logoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoSrc}
              alt={game.name}
              className="game-menu-logo"
              onError={() => setLogoIdx((i) => i + 1)}
            />
          ) : (
            <span className="game-menu-logo-fallback">{game.emoji || "🎮"}</span>
          )}
        </div>

        <h1 className="game-menu-title">{game.name}</h1>

        <div className="game-menu-actions">
          <button type="button" className="game-menu-btn game-menu-btn--start" onClick={onStart}>
            START
          </button>
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
