"use client";

import { useEffect, useState } from "react";

const COLORS = ["#35D07F", "#F5C542", "#5B8CFF", "#FF6B8A", "#FFFFFF"];

/**
 * Lightweight burst confetti (no dependency). Renders briefly then unmounts.
 */
export default function ClaimConfetti({
  active,
  durationMs = 1800,
}: {
  active: boolean;
  durationMs?: number;
}) {
  const [pieces, setPieces] = useState<
    { id: number; left: number; delay: number; color: string; rot: number }[]
  >([]);

  useEffect(() => {
    if (!active) {
      setPieces([]);
      return;
    }
    const next = Array.from({ length: 36 }, (_, i) => ({
      id: i,
      left: 8 + ((i * 17) % 84),
      delay: (i % 8) * 40,
      color: COLORS[i % COLORS.length],
      rot: (i * 47) % 360,
    }));
    setPieces(next);
    const t = window.setTimeout(() => setPieces([]), durationMs);
    return () => window.clearTimeout(t);
  }, [active, durationMs]);

  if (pieces.length === 0) return null;

  return (
    <div className="claim-confetti" aria-hidden>
      {pieces.map((p) => (
        <span
          key={p.id}
          className="claim-confetti__piece"
          style={{
            left: `${p.left}%`,
            background: p.color,
            animationDelay: `${p.delay}ms`,
            transform: `rotate(${p.rot}deg)`,
          }}
        />
      ))}
    </div>
  );
}
