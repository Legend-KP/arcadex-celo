"use client";

import { useEffect, useState } from "react";
import {
  DAILY_XP_GO_LIVE_AT_MS,
  formatDailyXpStartsIn,
  isDailyXpTransition,
} from "@/lib/daily-xp-board";

const HIGHLIGHTS = [
  { icon: "⚡", label: "Reach 100 XP" },
  { icon: "₮", label: "Win USDT rewards" },
  { icon: "↻", label: "Resets daily" },
] as const;

interface DailyXpTransitionProps {
  /** Compact layout for sheet / promo. */
  compact?: boolean;
  /** Called once when the transition window ends. */
  onGoLive?: () => void;
  hideClose?: boolean;
  onClose?: () => void;
}

export default function DailyXpTransition({
  compact = false,
  onGoLive,
  hideClose = false,
  onClose,
}: DailyXpTransitionProps) {
  const [countdown, setCountdown] = useState(() =>
    formatDailyXpStartsIn(DAILY_XP_GO_LIVE_AT_MS - Date.now())
  );

  useEffect(() => {
    const tick = () => {
      const remaining = DAILY_XP_GO_LIVE_AT_MS - Date.now();
      setCountdown(formatDailyXpStartsIn(remaining));
      if (remaining <= 0) {
        onGoLive?.();
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [onGoLive]);

  if (!isDailyXpTransition()) {
    return null;
  }

  return (
    <div
      className={`daily-xp-transition${
        compact ? " daily-xp-transition--compact" : ""
      }`}
    >
      {!hideClose && onClose ? (
        <div className="daily-xp-transition__top">
          <span className="daily-xp-transition__eyebrow">ArcadeX</span>
          <button
            type="button"
            className="lb-close"
            onClick={onClose}
            aria-label="Close Daily XP Board"
          >
            ✕
          </button>
        </div>
      ) : null}

      <header className="daily-xp-transition__header">
        <h2 className="daily-xp-transition__title">Daily XP Board</h2>
        <p className="daily-xp-transition__status">
          Weekly board frozen · New daily rewards soon
        </p>
      </header>

      <div className="lb-timer-panel daily-xp-transition__timer" role="status">
        <div className="lb-timer-panel__glow" aria-hidden="true" />
        <div className="lb-timer-panel__content">
          <p className="lb-timer-panel__label">Starts in</p>
          <p className="lb-timer-panel__value daily-xp-transition__countdown">
            {countdown}
          </p>
          <p className="daily-xp-transition__timer-note">
            Saturday 00:00 UTC
          </p>
        </div>
      </div>

      <ul className="daily-xp-transition__highlights" aria-label="What's new">
        {HIGHLIGHTS.map((item) => (
          <li key={item.label} className="daily-xp-transition__highlight">
            <span className="daily-xp-transition__highlight-icon" aria-hidden>
              {item.icon}
            </span>
            <span className="daily-xp-transition__highlight-label">
              {item.label}
            </span>
          </li>
        ))}
      </ul>

      <p className="daily-xp-transition__footer">
        This week&apos;s Top 10 will get rewarded · USDT amount coming shortly
      </p>
    </div>
  );
}
