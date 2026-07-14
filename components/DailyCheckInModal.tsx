"use client";

import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { formatChainError } from "@/lib/celo-public-client";
import { performDailyCheckIn, type StreakStatus } from "@/lib/streak-client";

interface DailyCheckInModalProps {
  open: boolean;
  walletAddress: string;
  status: StreakStatus | null;
  onComplete: (result: {
    day: number;
    milestone: boolean;
    infiniteSparkGranted: boolean;
  }) => void;
}

type Landmark = {
  day: number;
  kind: "start" | "next" | "milestone";
};

function FlameIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2c1.5 3.2-.2 5.2-1.6 6.7C8.8 10.3 8 12 8 14.2 8 17.4 10.2 20 13 20c2.6 0 4.7-2 4.9-4.6.2-2.2-.8-3.6-1.7-4.7-.5-.6-.9-1.2-1-2-.1 1.4.5 2.5 1.1 3.4 1.4 2 1.7 3.5 1.6 4.9C17.7 20.3 15.1 22.5 12 22.5 8.1 22.5 5 19.3 5 15.2c0-2.6 1.1-4.5 2.5-6C9 7.5 10.4 5.6 12 2z"
        fill="currentColor"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M5 10.5 8.2 14 15 6.5"
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GiftIcon() {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect x="6" y="14" width="20" height="14" rx="3" fill="#a78bfa" />
      <rect x="5" y="10" width="22" height="6" rx="2" fill="#8b5cf6" />
      <rect x="14.5" y="10" width="3" height="18" fill="#fbbf24" />
      <path
        d="M16 10c-2.2-3.5-5.5-3.2-5.5-.4C10.5 12 13.2 12.8 16 10z"
        fill="#f472b6"
      />
      <path
        d="M16 10c2.2-3.5 5.5-3.2 5.5-.4C21.5 12 18.8 12.8 16 10z"
        fill="#f472b6"
      />
    </svg>
  );
}

function ChestIcon() {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect x="4" y="14" width="24" height="14" rx="3" fill="#b45309" />
      <path d="M4 16h24v5H4z" fill="#f59e0b" />
      <rect x="6" y="8" width="20" height="8" rx="2" fill="#d97706" />
      <circle cx="16" cy="19" r="2.2" fill="#fde68a" />
      <circle cx="10" cy="12" r="1.6" fill="#34d399" />
      <circle cx="22" cy="11" r="1.4" fill="#60a5fa" />
      <circle cx="16" cy="9" r="1.5" fill="#f472b6" />
    </svg>
  );
}

function InfinitySparkIcon({ gradientId }: { gradientId: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden>
      <circle cx="20" cy="20" r="18" fill={`url(#${gradientId})`} />
      <path
        d="M20 8.5 22.4 16H30l-6.2 4.4L26.2 28 20 23.4 13.8 28l2.4-7.6L10 16h7.6L20 8.5z"
        fill="#fff"
      />
      <defs>
        <linearGradient id={gradientId} x1="6" y1="6" x2="34" y2="34">
          <stop stopColor="#fbbf24" />
          <stop offset="0.55" stopColor="#f59e0b" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function ShieldCheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M10 2.5 16 5v4.8c0 3.7-2.4 6.2-6 7.7-3.6-1.5-6-4-6-7.7V5l6-2.5z"
        fill="rgba(255,255,255,0.28)"
        stroke="#fff"
        strokeWidth="1.2"
      />
      <path
        d="M7.2 10.1 9.1 12l3.8-4.2"
        stroke="#fff"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function buildLandmarks(
  requiredDays: number,
  currentDay: number,
  wouldReset: boolean,
  checkInDay: number
): Landmark[] {
  const start: Landmark = { day: 1, kind: "start" };
  const milestone: Landmark = { day: requiredDays, kind: "milestone" };

  if (wouldReset || currentDay <= 0) {
    return [
      start,
      { day: Math.min(2, requiredDays), kind: "next" },
      milestone,
    ];
  }

  if (checkInDay >= requiredDays) {
    return [
      start,
      { day: Math.max(2, requiredDays - 1), kind: "next" },
      milestone,
    ];
  }

  if (checkInDay === 1) {
    return [start, { day: 1, kind: "next" }, milestone];
  }

  return [start, { day: checkInDay, kind: "next" }, milestone];
}

export default function DailyCheckInModal({
  open,
  walletAddress,
  status,
  onComplete,
}: DailyCheckInModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const infinityGradId = useId().replace(/:/g, "");

  if (!open || typeof document === "undefined") return null;

  const requiredDays = status?.campaign.requiredDays ?? 7;
  const currentDay = status?.currentDay ?? 0;
  const wouldReset = Boolean(status?.streakWouldReset);
  const checkInDay = wouldReset
    ? 1
    : currentDay === 0
      ? 1
      : Math.min(currentDay + 1, requiredDays);
  const displayStreak = wouldReset ? 0 : currentDay;
  const isFinalDay = checkInDay >= requiredDays;
  const landmarks = buildLandmarks(
    requiredDays,
    currentDay,
    wouldReset,
    checkInDay
  );

  const streakHeadline =
    displayStreak <= 0
      ? "Start your streak"
      : `${displayStreak} Day${displayStreak === 1 ? "" : "s"} Streak`;

  const streakHint = wouldReset
    ? "You missed a day — check in to start fresh."
    : displayStreak <= 0
      ? "Check in today to begin your 7-day run."
      : isFinalDay
        ? "Final check-in unlocks Infinite Spark!"
        : "Come back tomorrow to keep it going!";

  const nextRewardTitle = isFinalDay
    ? `Day ${requiredDays} Reward`
    : `Day ${requiredDays} Milestone`;
  const nextRewardDetail = "Infinite Spark · 24 hours";
  const nextRewardBadge = isFinalDay
    ? "Today"
    : displayStreak > 0
      ? `${requiredDays - displayStreak} left`
      : `Day ${requiredDays}`;

  function landmarkState(day: number): "done" | "active" | "upcoming" {
    if (wouldReset) {
      return day === 1 ? "active" : "upcoming";
    }
    if (currentDay >= day) return "done";
    if (checkInDay === day) return "active";
    return "upcoming";
  }

  const progressRatio = wouldReset
    ? 0
    : Math.min(currentDay / requiredDays, 1);

  async function handleCheckIn() {
    setLoading(true);
    setError("");
    try {
      const result = await performDailyCheckIn(walletAddress);
      onComplete({
        day: result.day,
        milestone: result.milestone,
        infiniteSparkGranted: Boolean(result.reward?.granted),
      });
    } catch (err) {
      setError(formatChainError(err) || "Check-in failed. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return createPortal(
    <div className="player-modal-backdrop" role="dialog" aria-modal="true">
      <div className="player-modal daily-checkin-modal">
        <div className="daily-checkin-hero-icon" aria-hidden>
          <FlameIcon />
        </div>

        <h2 className="daily-checkin-heading">
          <span aria-hidden>🔥</span> Daily Streak{" "}
          <span aria-hidden>🔥</span>
        </h2>
        <p className="daily-checkin-sub">
          Check in daily, build your streak, and unlock Infinite Spark.
        </p>

        <section className="daily-checkin-streak-card">
          <p className="daily-checkin-section-label daily-checkin-section-label--light">
            Your streak
          </p>
          <p className="daily-checkin-streak-value">
            <span aria-hidden>🔥</span>{" "}
            {displayStreak > 0 ? (
              <>
                <span className="daily-checkin-streak-num">
                  {displayStreak}
                </span>{" "}
                Day{displayStreak === 1 ? "" : "s"} Streak
              </>
            ) : (
              streakHeadline
            )}
          </p>
          <p className="daily-checkin-streak-hint">{streakHint}</p>

          <div className="daily-checkin-landmarks">
            {landmarks.map((landmark) => {
              const state = landmarkState(landmark.day);
              const isMilestone = landmark.kind === "milestone";
              return (
                <div
                  key={`${landmark.kind}-${landmark.day}`}
                  className={`daily-checkin-landmark daily-checkin-landmark--${state}${
                    isMilestone ? " daily-checkin-landmark--milestone" : ""
                  }`}
                >
                  <div className="daily-checkin-landmark-icon">
                    {state === "done" ? (
                      <span className="daily-checkin-check">
                        <CheckIcon />
                      </span>
                    ) : isMilestone ? (
                      <ChestIcon />
                    ) : (
                      <GiftIcon />
                    )}
                  </div>
                  <p className="daily-checkin-landmark-day">
                    Day {landmark.day}
                  </p>
                  <p className="daily-checkin-landmark-reward">
                    {isMilestone ? "∞ Spark" : "Progress"}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="daily-checkin-track" aria-hidden>
            <div
              className="daily-checkin-track-fill"
              style={{ width: `${Math.max(progressRatio * 100, 4)}%` }}
            />
            {landmarks.map((landmark) => {
              const left = ((landmark.day - 1) / (requiredDays - 1)) * 100;
              const state = landmarkState(landmark.day);
              return (
                <span
                  key={`node-${landmark.kind}-${landmark.day}`}
                  className={`daily-checkin-track-node daily-checkin-track-node--${state}`}
                  style={{ left: `${left}%` }}
                />
              );
            })}
          </div>
        </section>

        <section className="daily-checkin-reward-card">
          <p className="daily-checkin-section-label">Next reward</p>
          <div className="daily-checkin-reward-row">
            <div className="daily-checkin-reward-icon">
              <InfinitySparkIcon gradientId={`inf-${infinityGradId}`} />
            </div>
            <div className="daily-checkin-reward-copy">
              <p className="daily-checkin-reward-title">{nextRewardTitle}</p>
              <p className="daily-checkin-reward-detail">{nextRewardDetail}</p>
            </div>
            <span className="daily-checkin-reward-badge">{nextRewardBadge}</span>
          </div>
        </section>

        
          {error ? <p className="daily-checkin-error">{error}</p> : null}

          <button
            type="button"
            className="daily-checkin-btn"
            disabled={loading || !walletAddress}
            onClick={handleCheckIn}
          >
            <span className="daily-checkin-btn-main">
              <ShieldCheckIcon />
              {loading ? "Confirming…" : "Daily Check In(Free)"}
            </span>
            <span className="daily-checkin-btn-sub">Non-fee transaction</span>
          </button>
        </div>
      </div>,
    document.body
  );
}