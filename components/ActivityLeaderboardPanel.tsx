"use client";

import { useEffect, useState } from "react";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import {
  ActivityLeaderboardEntry,
  getActivityLeaderboard,
} from "@/lib/activity-client";
import { formatActivityCountdown } from "@/lib/activity-week";

const MEDALS = ["🥇", "🥈", "🥉"];

interface ActivityLeaderboardPanelProps {
  /** When true, fetch and render. When false, stay idle. */
  active: boolean;
  /** Compact layout for promo popup (shorter list). */
  compact?: boolean;
  /** Hide the top-right close when parent provides its own. */
  hideClose?: boolean;
  onClose?: () => void;
}

/**
 * Shared weekly activity board body — used by the XP sheet and leaderboard promos.
 */
export default function ActivityLeaderboardPanel({
  active,
  compact = false,
  hideClose = false,
  onClose,
}: ActivityLeaderboardPanelProps) {
  const { walletAddress } = usePlayerProfile();
  const [entries, setEntries] = useState<ActivityLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState("");
  const [endsAt, setEndsAt] = useState(0);
  const [me, setMe] = useState<{
    rank: number | null;
    score: number;
    activeDays: number;
  } | null>(null);

  useEffect(() => {
    if (!active) return;
    setLoading(true);
    getActivityLeaderboard({
      walletAddress: walletAddress || undefined,
      week: "current",
    })
      .then((data) => {
        setEntries(data.entries ?? []);
        setEndsAt(data.endsAtMs || data.endsAt || 0);
        setMe(data.me);
        if (data.resetsIn) setCountdown(data.resetsIn);
      })
      .catch(() => {
        setEntries([]);
        setMe(null);
      })
      .finally(() => setLoading(false));
  }, [active, walletAddress]);

  useEffect(() => {
    if (!active || !endsAt) {
      setCountdown("");
      return;
    }
    const tick = () => {
      setCountdown(formatActivityCountdown(endsAt - Date.now()));
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [active, endsAt]);

  const myWallet = walletAddress?.toLowerCase() ?? "";

  return (
    <div
      className={`activity-lb-panel${compact ? " activity-lb-panel--compact" : ""}`}
    >
      <div className="lb-header">
        <div className="lb-title-wrap">
          <span className="lb-trophy-hex" aria-hidden="true">
            🏆
          </span>
          <div className="lb-title-stack">
            <span className="lb-title">XP Leaderboard</span>
            <span className="activity-lb-reset" role="status">
              <span className="activity-lb-reset__dot" aria-hidden="true" />
              <span className="activity-lb-reset__label">Resets in</span>
              <span className="activity-lb-reset__value">
                {countdown || "…"}
              </span>
            </span>
          </div>
        </div>
        {!hideClose && onClose ? (
          <button
            type="button"
            className="lb-close"
            onClick={onClose}
            aria-label="Close leaderboard"
          >
            ✕
          </button>
        ) : null}
      </div>

      <div className="lb-timer-panel activity-lb-prize" role="status">
        <div className="lb-timer-panel__glow" aria-hidden="true" />
        <div className="lb-timer-panel__content">
          <p className="lb-timer-panel__label">Weekly prize</p>
          <p className="activity-lb-prize__amount">$10</p>
          <p className="activity-lb-prize__copy">for the Top 10 winners</p>
        </div>
        <div className="lb-timer-panel__trophy" aria-hidden="true">
          🏆
        </div>
      </div>

      {me && (
        <p className="activity-lb-you">
          You ·{" "}
          {me.score > 0 && me.rank != null ? `#${me.rank}` : "Unranked"} ·{" "}
          {me.score.toLocaleString()} XP
        </p>
      )}

      <div className="lb-table-head" aria-hidden="true">
        <span className="lb-table-head__rank">#</span>
        <span className="lb-table-head__player">PLAYER</span>
        <span className="lb-table-head__score">XP</span>
      </div>

      <div className="lb-list">
        {loading && <p className="lb-empty">Loading...</p>}
        {!loading && entries.length === 0 && (
          <p className="lb-empty">No activity yet — play a game!</p>
        )}
        {!loading &&
          entries.map((e, i) => {
            const isYou =
              Boolean(myWallet) &&
              e.walletAddress.toLowerCase() === myWallet;
            return (
              <div
                key={`${e.walletAddress}-${i}`}
                className={`lb-row${i === 0 ? " lb-row--first" : ""}${
                  i < 3 ? " lb-row--podium" : ""
                }${isYou ? " activity-lb-row--you" : ""}`}
              >
                <span
                  className={`lb-pos ${
                    i < 3 ? ["gold", "silver", "bronze"][i] : "other"
                  }`}
                >
                  {i < 3 ? MEDALS[i] : `#${i + 1}`}
                </span>
                <span className="lb-name">
                  {e.name}
                  {isYou ? " (you)" : ""}
                </span>
                <span className="lb-score">{e.score.toLocaleString()} XP</span>
              </div>
            );
          })}
      </div>
    </div>
  );
}
