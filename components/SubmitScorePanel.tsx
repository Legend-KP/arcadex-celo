"use client";

import { useEffect, useState } from "react";
import { LEADERBOARD_MAX_ENTRIES, LeaderboardEntry } from "@/types";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import {
  getLeaderboard,
  submitScoreToLeaderboard,
} from "@/lib/leaderboard-client";
import { purchaseScoreSubmitOnChain } from "@/lib/score-submit-purchase";

interface SubmitScorePanelProps {
  gameId: string;
  gameName: string;
  contestLive?: boolean;
  open: boolean;
  pendingScore?: number;
  onClose: () => void;
  onSubmitted?: () => void;
}

const MEDALS = ["🥇", "🥈", "🥉"];

export default function SubmitScorePanel({
  gameId,
  gameName,
  contestLive = false,
  open,
  pendingScore,
  onClose,
  onSubmitted,
}: SubmitScorePanelProps) {
  const { walletAddress, playerName } = usePlayerProfile();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [personalBest, setPersonalBest] = useState(0);
  const [leaderboardScore, setLeaderboardScore] = useState(0);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const submitScore = pendingScore ?? personalBest;
  const displayName = playerName?.trim() || "You";

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
      setLeaderboardScore(data.submittedBest ?? 0);
    } catch {
      setEntries([]);
      setPersonalBest(0);
      setLeaderboardScore(0);
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
    if (!walletAddress || submitting || submitScore <= 0) return;

    setSubmitting(true);
    setSubmitError("");
    setSubmitSuccess(false);

    try {
      const { txHash } = await purchaseScoreSubmitOnChain();
      const result = await submitScoreToLeaderboard(gameId, {
        walletAddress,
        txHash,
        score: submitScore,
      });
      setPersonalBest(result.highScore);
      setLeaderboardScore(result.leaderboardScore);
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
  }

  if (!open) return null;

  return (
    <div className="submit-panel-backdrop" onClick={onClose} role="presentation">
      <div
        className="submit-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Submit score for ${gameName}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="submit-panel__header">
          <div className="submit-panel__title-wrap">
            <span className="submit-panel__trophy" aria-hidden="true">🏆</span>
            <span className="submit-panel__title">{gameName}</span>
          </div>
          <button
            type="button"
            className="submit-panel__close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {contestLive && (
          <div className="submit-panel__contest" role="status">
            CONTEST LIVE
          </div>
        )}

        {!submitSuccess && (
          <button
            type="button"
            className="submit-panel__submit-btn"
            onClick={() => void handleSubmitScore()}
            disabled={submitting || submitScore <= 0}
          >
            {submitting ? "Submitting…" : "Submit Score"}
          </button>
        )}

        {submitSuccess && (
          <p className="submit-panel__success" role="status">
            Score submitted to the leaderboard!
          </p>
        )}

        {submitError && (
          <p className="submit-panel__error" role="alert">
            {submitError}
          </p>
        )}

        {submitScore > 0 && !submitSuccess && (
          <div className="submit-panel__hero">
            <p className="submit-panel__hero-label">Score to submit</p>
            <div className="submit-panel__hero-row">
              <span className="submit-panel__hero-name">{displayName}</span>
              <span className="submit-panel__hero-score">
                {submitScore.toLocaleString()}
              </span>
            </div>
            {personalBest > 0 && personalBest !== submitScore && (
              <p className="submit-panel__hero-hint">
                Personal best: {personalBest.toLocaleString()}
              </p>
            )}
            <p className="submit-panel__hero-hint">
              Submit to post on the leaderboard
              {contestLive ? " and enter the contest" : ""}.
              {leaderboardScore > 0
                ? ` Your current leaderboard score is ${leaderboardScore.toLocaleString()}.`
                : ""}
            </p>
          </div>
        )}

        <div className="submit-panel__list">
          {loading && <p className="submit-panel__empty">Loading...</p>}
          {!loading && entries.length === 0 && (
            <p className="submit-panel__empty">No scores on the leaderboard yet.</p>
          )}
          {!loading &&
            entries.map((e, i) => (
              <div
                key={i}
                className={`submit-panel__row${
                  i === 0 ? " submit-panel__row--first" : ""
                }${i < 3 ? " submit-panel__row--podium" : ""}`}
              >
                <span
                  className={`submit-panel__pos ${
                    i < 3 ? ["gold", "silver", "bronze"][i] : "other"
                  }`}
                >
                  {i < 3 ? MEDALS[i] : `#${i + 1}`}
                </span>
                <span className="submit-panel__name">{e.name}</span>
                <span className="submit-panel__score">{e.score.toLocaleString()}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
