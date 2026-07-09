"use client";

import { useEffect, useRef, useState } from "react";
import { LEADERBOARD_MAX_ENTRIES, LeaderboardEntry } from "@/types";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import {
  getLeaderboard,
  submitScoreToLeaderboard,
} from "@/lib/leaderboard-client";
import { purchaseScoreSubmitOnChain } from "@/lib/score-submit-purchase";

interface LeaderboardProps {
  gameId: string;
  gameName: string;
  contestLive?: boolean;
  open: boolean;
  onClose: () => void;
}

const MEDALS = ["🥇", "🥈", "🥉"];
const SWIPE_THRESHOLD = 60;

export default function Leaderboard({
  gameId,
  gameName,
  contestLive = false,
  open,
  onClose,
}: LeaderboardProps) {
  const { walletAddress, playerName } = usePlayerProfile();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [personalBest, setPersonalBest] = useState(0);
  const [submittedBest, setSubmittedBest] = useState(0);
  const [canSubmit, setCanSubmit] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const touchStartY = useRef<number | null>(null);

  async function loadLeaderboard() {
    setLoading(true);
    setSubmitError("");
    try {
      const data = await getLeaderboard(gameId, {
        walletAddress: walletAddress || undefined,
        playerName: playerName || undefined,
      });
      setEntries((data.entries ?? []).slice(0, LEADERBOARD_MAX_ENTRIES));
      setPersonalBest(data.personalBest ?? 0);
      setSubmittedBest(data.submittedBest ?? 0);
      setCanSubmit(Boolean(data.canSubmit));
    } catch {
      setEntries([]);
      setPersonalBest(0);
      setSubmittedBest(0);
      setCanSubmit(false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setSubmitSuccess(false);
    void loadLeaderboard();
  }, [open, gameId, walletAddress, playerName]);

  async function handleSubmitScore() {
    if (!walletAddress || submitting) return;

    setSubmitting(true);
    setSubmitError("");
    setSubmitSuccess(false);

    try {
      const { txHash } = await purchaseScoreSubmitOnChain();
      const result = await submitScoreToLeaderboard(gameId, {
        walletAddress,
        txHash,
      });
      setPersonalBest(result.personalBest);
      setSubmittedBest(result.submittedBest);
      setCanSubmit(result.canSubmit);
      setSubmitSuccess(true);
      await loadLeaderboard();
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Could not submit score."
      );
    } finally {
      setSubmitting(false);
    }
  }

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

        {contestLive && (
          <div className="lb-contest-banner" role="status">
            CONTEST LIVE
          </div>
        )}

        {canSubmit && (
          <div className="lb-submit-wrap">
            <button
              type="button"
              className="lb-submit-btn"
              onClick={() => void handleSubmitScore()}
              disabled={submitting}
            >
              {submitting ? "Submitting…" : "Submit Score"}
            </button>
            {submitError && (
              <p className="lb-submit-error" role="alert">
                {submitError}
              </p>
            )}
            {submitSuccess && (
              <p className="lb-submit-success" role="status">
                Score submitted to the leaderboard!
              </p>
            )}
          </div>
        )}

        {!canSubmit && personalBest > 0 && submittedBest > 0 && (
          <p className="lb-submit-hint">
            Your best submitted score: {submittedBest.toLocaleString()}
          </p>
        )}

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
                <span className="lb-name">{e.name}</span>
                <span className="lb-score">{e.score.toLocaleString()}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
