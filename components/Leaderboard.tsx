"use client";

import { useEffect, useRef, useState } from "react";
import { LEADERBOARD_MAX_ENTRIES, LeaderboardEntry } from "@/types";

interface LeaderboardProps {
  gameId: string;
  gameName: string;
  open: boolean;
  onClose: () => void;
}

const MEDALS = ["🥇", "🥈", "🥉"];
const SWIPE_THRESHOLD = 60;

export default function Leaderboard({
  gameId,
  gameName,
  open,
  onClose,
}: LeaderboardProps) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const touchStartY = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch(`/api/games/${gameId}/leaderboard`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { entries?: LeaderboardEntry[] }) =>
        setEntries((data.entries ?? []).slice(0, LEADERBOARD_MAX_ENTRIES))
      )
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [open, gameId]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartY.current === null) return;
    const delta = e.changedTouches[0].clientY - touchStartY.current;
    touchStartY.current = null;
    if (delta > SWIPE_THRESHOLD) onClose();
  };

  if (!open) return null;

  return (
    <div className="lb-backdrop" onClick={onClose} role="presentation">
      <div
        className="lb-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`${gameName} leaderboard`}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div className="lb-header">
          <div className="lb-title-wrap">
            <span className="lb-trophy" aria-hidden="true">🏆</span>
            <span className="lb-title">{gameName}</span>
          </div>
          <button type="button" className="lb-close" onClick={onClose} aria-label="Close leaderboard">
            ✕
          </button>
        </div>

        <div className="lb-list">
          {loading && <p className="lb-empty">Loading...</p>}
          {!loading && entries.length === 0 && (
            <p className="lb-empty">No scores yet — be the first!</p>
          )}
          {!loading &&
            entries.map((e, i) => (
              <div
                key={i}
                className={`lb-row${i === 0 ? " lb-row--first" : ""}${i < 3 ? " lb-row--podium" : ""}`}
              >
                <span
                  className={`lb-pos ${i < 3 ? ["gold", "silver", "bronze"][i] : "other"}`}
                >
                  {i < 3 ? MEDALS[i] : `#${i + 1}`}
                </span>
                <span className="lb-name">
                  {e.isHumanVerified && (
                    <span className="human-badge" title="Verified human" aria-label="Verified human">
                      ✓
                    </span>
                  )}
                  {e.name}
                </span>
                <span className="lb-score">{e.score.toLocaleString()}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
