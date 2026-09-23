"use client";

import { useEffect, useRef, useState } from "react";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import {
  ActivityLeaderboardEntry,
  getActivityLeaderboard,
  pingActivityVisit,
} from "@/lib/activity-client";
import { formatActivityCountdown } from "@/lib/activity-week";

const MEDALS = ["🥇", "🥈", "🥉"];

/** Inline weekly activity leaderboard for the drawer Global Leaderboard view. */
export default function ActivityLeaderboardView() {
  const { walletAddress } = usePlayerProfile();
  const [entries, setEntries] = useState<ActivityLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState("");
  const [endsAt, setEndsAt] = useState(0);
  const [me, setMe] = useState<{
    rank: number | null;
    score: number;
    activeDays: number;
  } | null>(null);
  const pingedRef = useRef(false);

  useEffect(() => {
    if (!walletAddress || pingedRef.current) return;
    pingedRef.current = true;
    void pingActivityVisit(walletAddress);
  }, [walletAddress]);

  useEffect(() => {
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
  }, [walletAddress]);

  useEffect(() => {
    if (!endsAt) {
      setCountdown("");
      return;
    }
    const tick = () => {
      setCountdown(formatActivityCountdown(endsAt - Date.now()));
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [endsAt]);

  const myWallet = walletAddress?.toLowerCase() ?? "";

  return (
    <div className="activity-lb-view">
      <header className="activity-lb-view__header">
        <h2 className="activity-lb-view__title">Weekly Activity Leaderboard</h2>
        <p className="activity-lb-hint">
          Come daily and play games to climb the board.
        </p>
      </header>

      <div className="lb-timer-panel" role="status">
        <div className="lb-timer-panel__glow" aria-hidden="true" />
        <div className="lb-timer-panel__content">
          <p className="lb-timer-panel__label">Resets in</p>
          <p className="lb-timer-panel__value">{countdown || "…"}</p>
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
                <span className="lb-score">
                  {e.score.toLocaleString()} XP
                </span>
              </div>
            );
          })}
      </div>
    </div>
  );
}
