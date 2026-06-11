"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { gameAssetCandidates } from "@/lib/game-assets";
import { formatPlayCount } from "@/lib/format-play-count";
import { Game } from "@/types";

interface GameCardProps {
  game: Game;
  playCount?: number;
}

export default function GameCard({ game, playCount = 0 }: GameCardProps) {
  const thumbCandidates = useMemo(
    () => gameAssetCandidates(game, "thumbnail"),
    [game]
  );
  const logoCandidates = useMemo(
    () => gameAssetCandidates(game, "logo"),
    [game]
  );

  const [thumbIdx, setThumbIdx] = useState(0);
  const [logoIdx, setLogoIdx] = useState(0);

  const thumbSrc = thumbCandidates[thumbIdx];
  const logoSrc = logoCandidates[logoIdx];

  return (
    <Link href={`/game/${game.id}`} className="game-card">
      <div className="thumb-wrap">
        {thumbSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbSrc}
            alt={game.name}
            className="thumb-img"
            onError={() => setThumbIdx((i) => i + 1)}
          />
        ) : logoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoSrc}
            alt={game.name}
            className="thumb-img"
            onError={() => setLogoIdx((i) => i + 1)}
          />
        ) : (
          <div className="thumb-placeholder">{game.emoji || "🎮"}</div>
        )}
      </div>

      <div className="card-info">
        <p className="card-title">{game.name}</p>
        <p className="card-plays">{formatPlayCount(playCount)} plays</p>
      </div>
    </Link>
  );
}
