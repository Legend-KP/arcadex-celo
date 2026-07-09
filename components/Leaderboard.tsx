"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LEADERBOARD_MAX_ENTRIES, LeaderboardEntry } from "@/types";
import {
  getLeaderboardStatus,
} from "@/lib/leaderboard-client";
import { getPendingScore, clearPendingScore } from "@/lib/pending-score";
import { executePaidScoreSubmit } from "@/lib/submit-score-flow";
import { useResolvedWallet } from "@/lib/use-resolved-wallet";

interface LeaderboardProps {
  gameId: string;
  gameName: string;
  open: boolean;
  contestLive?: boolean;
  walletAddress?: string;
  playerName?: string;
  onClose: () => void;
  onSubmitted?: () => void;
}

const MEDALS = ["🥇", "🥈", "🥉"];
const SWIPE_THRESHOLD = 60;

export default function Leaderboard({
  gameId,
  gameName,
  open,
  contestLive = false,
  walletAddress = "",
  playerName = "",
  onClose,
  onSubmitted,
}: LeaderboardProps) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [personalBest, setPersonalBest] = useState(0);
  const [submittedBest, setSubmittedBest] = useState(0);
  const [pendingScore, setPendingScoreState] = useState(0);
  const [canSubmit, setCanSubmit] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const touchStartY = useRef<number | null>(null);
  const resolvedWallet = useResolvedWallet(walletAddress);

  const loadLeaderboard = useCallback(async () => {
    setLoading(true);
    setSubmitError("");
    try {
      const pending = getPendingScore(gameId);
      setPendingScoreState(pending);

      const status = await getLeaderboardStatus(gameId, {
        walletAddress: resolvedWallet || undefined,
        playerName: playerName || undefined,
      });
      setEntries(status.entries.slice(0, LEADERBOARD_MAX_ENTRIES));
      setPersonalBest(status.personalBest);
      setSubmittedBest(status.submittedBest);
      setPendingScoreState(status.pendingScore);
      setCanSubmit(status.canSubmit);
    } catch {
      setEntries([]);
      setCanSubmit(false);
    } finally {
      setLoading(false);
    }
  }, [gameId, resolvedWallet, playerName]);

  useEffect(() => {
    if (!open) return;
    setSubmitSuccess(false);
    void loadLeaderboard();
  }, [open, loadLeaderboard]);

  const submitScoreValue = Math.max(personalBest, pendingScore);

  const handleSubmitScore = async () => {
    if (!resolvedWallet || submitting || !canSubmit || submitScoreValue <= 0) {
      return;
    }

    if (!playerName.trim()) {
      setSubmitError("Set your player name before submitting.");
      return;
    }

    setSubmitting(true);
    setSubmitError("");
    setSubmitSuccess(false);

    try {
      const result = await executePaidScoreSubmit(gameId, {
        walletAddress: resolvedWallet,
        playerName: playerName.trim(),
        score: submitScoreValue,
      });

      clearPendingScore(gameId);
      setPendingScoreState(0);
      setPersonalBest(result.score);
      setSubmittedBest(result.submittedBest);
      setCanSubmit(result.score > result.submittedBest);
      setSubmitSuccess(true);
      await loadLeaderboard();
      onSubmitted?.();
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Could not submit score."
      );
    } finally {
      setSubmitting(false);
    }
  };

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
        {contestLive && (
          <div className="lb-contest-banner" role="status">
            CONTEST LIVE
          </div>
        )}

        <div className="lb-header">
          <div className="lb-title-wrap">
            <span className="lb-trophy" aria-hidden="true">
              🏆
            </span>
            <span className="lb-title">{gameName}</span>
          </div>
          <button
            type="button"
            className="lb-close"
            onClick={onClose}
            aria-label="Close leaderboard"
          >
            ✕
          </button>
        </div>

        {resolvedWallet && canSubmit && (
          <div className="lb-submit-wrap">
            <button
              type="button"
              className="lb-submit-btn"
              onClick={handleSubmitScore}
              disabled={submitting}
            >
              {submitting ? "Submitting…" : "Submit Score"}
            </button>
            {pendingScore > submittedBest && (
              <p className="lb-submit-pending">
                Pending score: {pendingScore.toLocaleString()}
              </p>
            )}
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

        {resolvedWallet && submitScoreValue > 0 && (
          <p className="lb-personal-note">
            {pendingScore > personalBest
              ? `Ready to submit: ${pendingScore.toLocaleString()}`
              : personalBest > 0
                ? `Your best: ${personalBest.toLocaleString()}`
                : ""}
            {submittedBest > 0
              ? ` · On leaderboard: ${submittedBest.toLocaleString()}`
              : ""}
          </p>
        )}
      </div>
    </div>
  );
}
