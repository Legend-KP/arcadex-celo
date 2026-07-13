"use client";

import { useEffect, useRef, useState } from "react";
import {
  CONTEST_DURATION_OPTIONS,
  ContestDurationDays,
  ContestInfo,
  LEADERBOARD_MAX_ENTRIES,
  LeaderboardEntry,
} from "@/types";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import { formatContestCountdown } from "@/lib/contest";
import { getLeaderboard } from "@/lib/leaderboard-client";

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
  const [contest, setContest] = useState<ContestInfo | null>(null);
  const [submittedBest, setSubmittedBest] = useState(0);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState("");
  const touchStartY = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getLeaderboard(gameId, {
      walletAddress: walletAddress || undefined,
      playerName: playerName || undefined,
    })
      .then((data) => {
        setContest(data.contest ?? null);
        if (data.contest) {
          setEntries(data.contest.entries ?? []);
        } else {
          setEntries((data.entries ?? []).slice(0, LEADERBOARD_MAX_ENTRIES));
        }
        setSubmittedBest(data.submittedBest ?? 0);
      })
      .catch(() => {
        setEntries([]);
        setContest(null);
        setSubmittedBest(0);
      })
      .finally(() => setLoading(false));
  }, [open, gameId, walletAddress, playerName]);

  useEffect(() => {
    if (!open || contest?.status !== "live") {
      setCountdown("");
      return;
    }

    const tick = () => {
      setCountdown(formatContestCountdown(contest.endsAt - Date.now()));
    };

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [open, contest]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartY.current === null) return;
    const delta = e.changedTouches[0].clientY - touchStartY.current;
    touchStartY.current = null;
    if (delta > SWIPE_THRESHOLD) onClose();
  };

  const showContestBoard = Boolean(contest);
  const isLiveContest = contest?.status === "live" || contestLive;

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

        {isLiveContest && (
          <div className="lb-contest-banner" role="status">
            <span>CONTEST LIVE</span>
            {countdown && <span className="lb-contest-countdown">{countdown}</span>}
          </div>
        )}

        {contest?.status === "ended" && (
          <div className="lb-contest-ended" role="status">
            Contest ended — final top 10
          </div>
        )}

        {contest?.task && (
          <div className="lb-contest-task">
            <p className="lb-contest-task-label">Contest task</p>
            <p className="lb-contest-task-text">{contest.task}</p>
          </div>
        )}

        {submittedBest > 0 && !showContestBoard && (
          <p className="lb-submit-hint">
            Your best submitted score: {submittedBest.toLocaleString()}
          </p>
        )}

        <div className="lb-list">
          {loading && <p className="lb-empty">Loading...</p>}
          {!loading && entries.length === 0 && (
            <p className="lb-empty">
              {showContestBoard
                ? "No contest scores yet — be the first!"
                : "No scores yet — be the first!"}
            </p>
          )}
          {!loading &&
            entries.map((e, i) => (
              <div
                key={`${e.walletAddress ?? e.name}-${i}`}
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
