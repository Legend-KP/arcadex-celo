"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import {
  getDailyXpLeaderboard,
  performDailyXpClaim,
  type DailyXpBoardResponse,
} from "@/lib/daily-xp-client";
import {
  DAILY_XP_CAMPAIGN_ID,
  DAILY_XP_THRESHOLD,
  formatDailyXpCountdown,
  type DailyXpLeaderboardEntry,
} from "@/lib/daily-xp-board";
import { claimShuffleRewardOnChain } from "@/lib/arcadex-rewards-spin";

const MEDALS = ["🥇", "🥈", "🥉"];

interface DailyXpLiveBoardProps {
  compact?: boolean;
  hideClose?: boolean;
  onClose?: () => void;
}

export default function DailyXpLiveBoard({
  compact = false,
  hideClose = false,
  onClose,
}: DailyXpLiveBoardProps) {
  const { walletAddress } = usePlayerProfile();
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimMsg, setClaimMsg] = useState<string | null>(null);
  const [entries, setEntries] = useState<DailyXpLeaderboardEntry[]>([]);
  const [countdown, setCountdown] = useState("");
  const [endsAt, setEndsAt] = useState(0);
  const [me, setMe] = useState<DailyXpBoardResponse["me"]>(null);
  const [threshold, setThreshold] = useState(DAILY_XP_THRESHOLD);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getDailyXpLeaderboard({
        walletAddress: walletAddress || undefined,
      });
      setEntries(data.entries ?? []);
      setEndsAt(data.endsAtMs || data.endsAt || 0);
      setMe(data.me);
      setThreshold(data.threshold ?? DAILY_XP_THRESHOLD);
      if (data.resetsIn) setCountdown(data.resetsIn);
    } catch (err) {
      setEntries([]);
      setMe(null);
      setError(err instanceof Error ? err.message : "Failed to load board.");
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!endsAt) {
      setCountdown("");
      return;
    }
    const tick = () => {
      setCountdown(formatDailyXpCountdown(endsAt - Date.now()));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [endsAt]);

  async function handleClaim() {
    if (!walletAddress || claiming) return;
    setClaiming(true);
    setClaimMsg(null);
    setError(null);
    try {
      if (me?.claimed) {
        // Spin already synced — retry on-chain claim() only.
        await claimShuffleRewardOnChain(DAILY_XP_CAMPAIGN_ID);
        setClaimMsg("0.02 USDT claimed!");
      } else {
        await performDailyXpClaim(walletAddress);
        setClaimMsg("0.02 USDT claimed!");
      }
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Claim failed.");
    } finally {
      setClaiming(false);
    }
  }

  const myWallet = walletAddress?.toLowerCase() ?? "";
  const xp = me?.score ?? 0;
  const progressPct = Math.min(100, Math.round((xp / threshold) * 100));
  const canClaim = Boolean(me?.canClaim);

  return (
    <div
      className={`daily-xp-live${compact ? " daily-xp-live--compact" : ""}`}
    >
      <div className="lb-header">
        <div className="lb-title-wrap">
          <span className="lb-trophy-hex" aria-hidden="true">
            ⚡
          </span>
          <div className="lb-title-stack">
            <span className="lb-title">Daily XP Board</span>
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
            aria-label="Close Daily XP Board"
          >
            ✕
          </button>
        ) : null}
      </div>

      <div className="daily-xp-progress" role="status">
        <div className="daily-xp-progress__row">
          <span className="daily-xp-progress__label">
            {xp.toLocaleString()} / {threshold} XP
          </span>
          {me?.checkedIn ? (
            <span className="daily-xp-progress__badge">Checked in</span>
          ) : (
            <span className="daily-xp-progress__badge daily-xp-progress__badge--warn">
              Check in required
            </span>
          )}
        </div>
        <div className="daily-xp-progress__bar" aria-hidden>
          <span style={{ width: `${progressPct}%` }} />
        </div>
        {me?.claimed ? (
          <p className="daily-xp-progress__hint">Reward claimed for today.</p>
        ) : xp < threshold ? (
          <p className="daily-xp-progress__hint">
            Reach {threshold} XP today to unlock Claim (0.02 USDT).
          </p>
        ) : !me?.checkedIn ? (
          <p className="daily-xp-progress__hint">
            Check in today to unlock Claim.
          </p>
        ) : (
          <p className="daily-xp-progress__hint">
            You&apos;re eligible — claim 0.02 USDT before UTC midnight.
          </p>
        )}
        <button
          type="button"
          className="daily-xp-live-shell__claim"
          disabled={(!canClaim && !me?.claimed) || claiming}
          onClick={() => void handleClaim()}
          style={
            (canClaim || me?.claimed) && !claiming
              ? { opacity: 1, cursor: "pointer" }
              : undefined
          }
        >
          {claiming
            ? "Claiming…"
            : me?.claimed
              ? "Claim USDT (if pending)"
              : "Claim 0.02 USDT"}
        </button>
        {claimMsg ? (
          <p className="daily-xp-progress__ok">{claimMsg}</p>
        ) : null}
        {error ? <p className="daily-xp-progress__err">{error}</p> : null}
      </div>

      {me ? (
        <p className="activity-lb-you">
          You ·{" "}
          {me.score > 0 && me.rank != null ? `#${me.rank}` : "Unranked"} ·{" "}
          {me.score.toLocaleString()} XP
        </p>
      ) : null}

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
