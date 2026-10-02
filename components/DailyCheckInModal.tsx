"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatChainError } from "@/lib/celo-public-client";
import { playSuccessSfx, playTouchSfx } from "@/lib/sfx";
import {
  claimStreakUsdt,
  fetchPendingStreakUsdt,
  fetchStreakStatus,
  performDailyCheckIn,
  refreshSessionFromCheckIn,
  type StreakStatus,
  type StreakUsdtPendingItem,
} from "@/lib/streak-client";
import {
  formatDayColumnCaption,
  formatNextRewardLine,
  formatStreakRewardDetail,
  formatUsdtAmount,
  getStreakDayReward,
  getStreakRewardSpotlight,
  isStreakHighlightDay,
  isStreakLadderV2Enabled,
  STREAK_LADDER_REQUIRED_DAYS,
  type StreakDayReward,
} from "@/lib/streak-rewards";

interface DailyCheckInModalProps {
  open: boolean;
  walletAddress: string;
  /** Runtime campaign from /api/daily-play-config — never trust build-time alone. */
  campaignId: number;
  status: StreakStatus | null;
  onComplete: (result: {
    day: number;
    milestone: boolean;
    infiniteSparkGranted: boolean;
  }) => void;
}

/** Show one week at a time (matches mock day-column strip). */
const CAROUSEL_PAGE_SIZE = 7;

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

function ChevronIcon({ dir }: { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d={dir === "left" ? "M12.5 5 7.5 10l5 5" : "M7.5 5 12.5 10l-5 5"}
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function XpIcon({ className }: { className?: string }) {
  const uid = useId().replace(/:/g, "");
  const gradId = `streakXpGrad-${uid}`;
  return (
    <svg
      className={`daily-checkin-xp-coin ${className ?? ""}`.trim()}
      viewBox="0 0 40 40"
      aria-hidden
    >
      <circle cx="20" cy="20" r="18" fill={`url(#${gradId})`} />
      <circle
        cx="20"
        cy="20"
        r="14.5"
        fill="none"
        stroke="rgba(255,255,255,0.45)"
        strokeWidth="1.5"
      />
      <text
        x="20"
        y="24"
        textAnchor="middle"
        fill="#7c2d12"
        fontSize="11"
        fontWeight="900"
        fontFamily="system-ui,sans-serif"
      >
        XP
      </text>
      <defs>
        <linearGradient id={gradId} x1="8" y1="4" x2="32" y2="36">
          <stop stopColor="#fde68a" />
          <stop offset="0.45" stopColor="#fbbf24" />
          <stop offset="1" stopColor="#d97706" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function GiftIcon({ className }: { className?: string }) {
  return (
    <svg
      className={`daily-checkin-gift-icon ${className ?? ""}`.trim()}
      viewBox="0 0 40 40"
      aria-hidden
    >
      <rect x="7" y="16" width="26" height="18" rx="3" fill="#a78bfa" />
      <rect x="7" y="16" width="26" height="6" rx="2" fill="#c4b5fd" />
      <rect x="18" y="16" width="4" height="18" fill="#7c3aed" />
      <path
        d="M20 16c-3.2-4.8-8-4.2-8-1.2 0 1.8 1.7 2.8 4.2 2.8H20z"
        fill="#f9a8d4"
      />
      <path
        d="M20 16c3.2-4.8 8-4.2 8-1.2 0 1.8-1.7 2.8-4.2 2.8H20z"
        fill="#f472b6"
      />
    </svg>
  );
}

function SparkBoltIcon({ className }: { className?: string }) {
  const uid = useId().replace(/:/g, "");
  const gradId = `streakSparkGrad-${uid}`;
  return (
    <svg
      className={`daily-checkin-spark-icon ${className ?? ""}`.trim()}
      viewBox="0 0 40 40"
      aria-hidden
    >
      <circle cx="20" cy="20" r="18" fill={`url(#${gradId})`} />
      <path
        d="M22.5 8 12 22h7l-1.5 10L29 18h-7l.5-10z"
        fill="#fff"
        stroke="rgba(255,255,255,0.35)"
        strokeWidth="0.6"
      />
      <defs>
        <linearGradient id={gradId} x1="8" y1="4" x2="32" y2="36">
          <stop stopColor="#fde68a" />
          <stop offset="1" stopColor="#f59e0b" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function UsdtGlyphIcon({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static public asset
    <img
      className={`daily-checkin-usdt-icon ${className ?? ""}`.trim()}
      src="/tether-usdt-logo.png"
      alt=""
      aria-hidden
      draggable={false}
    />
  );
}

function dayNodeState(
  day: number,
  currentDay: number,
  checkInDay: number,
  wouldReset: boolean
): "done" | "today" | "upcoming" {
  if (wouldReset) {
    return day === 1 ? "today" : "upcoming";
  }
  if (currentDay >= day) return "done";
  if (checkInDay === day) return "today";
  return "upcoming";
}

function rewardGlyph(
  reward: StreakDayReward | null,
  state: "done" | "today" | "upcoming"
): "usdt" | "spark" | "xp" | "gift" {
  if (!reward) return "xp";
  if (reward.usdt != null) return "usdt";
  if (reward.infiniteHours != null) return "spark";
  if (state === "today" || state === "done") return "xp";
  return "gift";
}

export default function DailyCheckInModal({
  open,
  walletAddress,
  campaignId,
  status,
  onComplete,
}: DailyCheckInModalProps) {
  const [loading, setLoading] = useState(false);
  const [claimingUsdt, setClaimingUsdt] = useState(false);
  const [error, setError] = useState("");
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [carouselPage, setCarouselPage] = useState(0);
  const [pendingUsdt, setPendingUsdt] = useState<StreakUsdtPendingItem[]>([]);
  const [usdtPayoutsEnabled, setUsdtPayoutsEnabled] = useState(false);
  const [success, setSuccess] = useState<{
    title: string;
    body: string;
    claimUsdt?: StreakUsdtPendingItem | null;
  } | null>(null);
  const pendingCompleteRef = useRef<{
    day: number;
    milestone: boolean;
    infiniteSparkGranted: boolean;
  } | null>(null);
  const recoverAttemptedRef = useRef(false);
  const daysScrollRef = useRef<HTMLDivElement | null>(null);
  const ladderV2 = isStreakLadderV2Enabled();
  const activeCampaignId =
    Number.isFinite(campaignId) && campaignId >= 1
      ? campaignId
      : status?.campaignId && status.campaignId >= 1
        ? status.campaignId
        : 4;

  useEffect(() => {
    if (!open || !walletAddress || recoverAttemptedRef.current) return;
    // Parent only opens this when check-in is still required. Never silent-skip
    // off a different campaign's progress (build-time id mismatch).
    if (status?.canCheckIn !== false) return;
    recoverAttemptedRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        const fresh = await fetchStreakStatus(walletAddress, activeCampaignId, {
          fresh: true,
        });
        if (cancelled || fresh.canCheckIn) return;

        setLoading(true);
        await refreshSessionFromCheckIn(walletAddress, activeCampaignId);
        if (cancelled) return;
        playSuccessSfx();
        const day = Math.max(1, fresh.currentDay);
        pendingCompleteRef.current = {
          day: fresh.currentDay,
          milestone: fresh.milestoneReached,
          infiniteSparkGranted: false,
        };
        setSuccess({
          title: "You're signed in!",
          body: `Welcome back. Day ${day} is already locked in for today — enjoy ArcadeX!`,
          claimUsdt: null,
        });
      } catch {
        // Still need a check-in / user action
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, walletAddress, activeCampaignId, status?.canCheckIn]);

  useEffect(() => {
    if (!open) {
      recoverAttemptedRef.current = false;
      setSuccess(null);
      setSelectedDay(null);
      setCarouselPage(0);
      setPendingUsdt([]);
      setError("");
      pendingCompleteRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!open || !walletAddress || !ladderV2) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await fetchPendingStreakUsdt(walletAddress);
        if (cancelled) return;
        setUsdtPayoutsEnabled(result.payoutsEnabled);
        setPendingUsdt(result.pending);
      } catch {
        if (!cancelled) setPendingUsdt([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, walletAddress, ladderV2]);

  const finishSuccess = useCallback(() => {
    const pending = pendingCompleteRef.current;
    pendingCompleteRef.current = null;
    setSuccess(null);
    if (pending) onComplete(pending);
  }, [onComplete]);

  useEffect(() => {
    if (!success) return;
    const id = window.setTimeout(() => finishSuccess(), 5500);
    return () => window.clearTimeout(id);
  }, [success, finishSuccess]);

  // Scroll carousel to the active check-in day when opening.
  useEffect(() => {
    if (!open || !ladderV2) return;
    const current = status?.currentDay ?? 0;
    const lastAt = status?.lastCheckInAt ?? 0;
    const reset =
      Boolean(status?.streakWouldReset) && current > 0 && lastAt > 0;
    const day = reset
      ? 1
      : current === 0
        ? 1
        : Math.min(current + 1, STREAK_LADDER_REQUIRED_DAYS);
    const page = Math.floor((day - 1) / CAROUSEL_PAGE_SIZE);
    const id = window.requestAnimationFrame(() => {
      setCarouselPage(page);
      const el = daysScrollRef.current;
      const target = el?.querySelector<HTMLElement>(
        `[data-streak-day="${day}"]`
      );
      target?.scrollIntoView({
        behavior: "smooth",
        inline: "center",
        block: "nearest",
      });
    });
    return () => window.cancelAnimationFrame(id);
  }, [
    open,
    ladderV2,
    status?.currentDay,
    status?.streakWouldReset,
    status?.lastCheckInAt,
  ]);

  if (!open || typeof document === "undefined") return null;

  const chainRequiredDays = status?.campaign.requiredDays ?? 7;
  const requiredDays = ladderV2 ? STREAK_LADDER_REQUIRED_DAYS : chainRequiredDays;
  const currentDay = status?.currentDay ?? 0;
  const lastCheckInAt = status?.lastCheckInAt ?? 0;
  const isFirstTimeStreak = lastCheckInAt <= 0 && currentDay <= 0;
  const wouldResetRaw = Boolean(status?.streakWouldReset);
  const wouldReset =
    wouldResetRaw && !isFirstTimeStreak && currentDay > 0 && lastCheckInAt > 0;
  const checkInDay = wouldReset
    ? 1
    : currentDay === 0
      ? 1
      : Math.min(currentDay + 1, requiredDays);
  const displayStreak = wouldReset ? 0 : currentDay;
  const isFinalDay = checkInDay >= requiredDays;
  const days = Array.from({ length: requiredDays }, (_, i) => i + 1);

  const pageCount = Math.max(1, Math.ceil(requiredDays / CAROUSEL_PAGE_SIZE));
  const safePage = Math.min(carouselPage, pageCount - 1);

  const streakHint = wouldReset
    ? "Your previous run ended — check in to start day 1 again."
    : displayStreak <= 0
      ? ladderV2
        ? `Check in today to begin your ${requiredDays}-day run.`
        : "Check in today to begin your 7-day run."
      : isFinalDay
        ? ladderV2
          ? "Final check-in unlocks the day 30 finale!"
          : "Final check-in unlocks Infinite Spark!"
        : displayStreak === 1
          ? "Nice! Come back tomorrow."
          : "Good start! Keep it going!";

  const todayReward = ladderV2 ? getStreakDayReward(checkInDay) : null;
  const peekedReward =
    ladderV2 && selectedDay != null ? getStreakDayReward(selectedDay) : null;
  const spotlight =
    ladderV2 && !peekedReward
      ? getStreakRewardSpotlight(checkInDay)
      : null;
  const cardReward =
    peekedReward ??
    todayReward ??
    spotlight?.reward ??
    ({
      day: checkInDay,
      xp: 10,
      xpBonus: 0,
      usdt: null,
      infiniteHours: null,
    } satisfies StreakDayReward);

  const nextRewardTitle = ladderV2
    ? formatNextRewardLine(cardReward)
    : isFinalDay
      ? `Day ${requiredDays} Reward`
      : `Day ${requiredDays} Milestone`;

  const nextRewardBadge = ladderV2
    ? selectedDay != null
      ? `Day ${cardReward.day}`
      : cardReward.day === checkInDay
        ? "Today"
        : `Day ${cardReward.day}`
    : isFinalDay
      ? "Today"
      : displayStreak > 0
        ? `${requiredDays - displayStreak} days left`
        : `Day ${requiredDays}`;

  const rewardIconKind = ladderV2
    ? rewardGlyph(
        cardReward,
        selectedDay != null && selectedDay === checkInDay
          ? "today"
          : selectedDay != null && selectedDay < checkInDay
            ? "done"
            : selectedDay != null
              ? "upcoming"
              : "today"
      )
    : "spark";

  function scrollToPage(page: number) {
    const next = Math.max(0, Math.min(page, pageCount - 1));
    setCarouselPage(next);
    const el = daysScrollRef.current;
    if (!el) return;
    const target = el.querySelector<HTMLElement>(
      `[data-streak-day="${next * CAROUSEL_PAGE_SIZE + 1}"]`
    );
    target?.scrollIntoView({
      behavior: "smooth",
      inline: "start",
      block: "nearest",
    });
  }

  function syncPageFromScroll() {
    const el = daysScrollRef.current;
    if (!el) return;
    const first = el.querySelector<HTMLElement>("[data-streak-day]");
    if (!first) return;
    const dayWidth = first.offsetWidth + 10;
    if (dayWidth <= 0) return;
    const page = Math.round(el.scrollLeft / (dayWidth * CAROUSEL_PAGE_SIZE));
    setCarouselPage(Math.max(0, Math.min(page, pageCount - 1)));
  }

  async function handleCheckIn() {
    playTouchSfx();
    setLoading(true);
    setError("");
    try {
      const result = await performDailyCheckIn(
        walletAddress,
        activeCampaignId
      );
      playSuccessSfx();
      const sparkGranted = Boolean(
        result.reward?.granted ||
          (result.ladder?.infiniteHoursGranted != null && result.ladder.granted)
      );
      const complete = {
        day: result.day,
        milestone: result.milestone,
        infiniteSparkGranted: sparkGranted,
      };
      pendingCompleteRef.current = complete;
      const dayReward = ladderV2 ? getStreakDayReward(complete.day) : null;
      const claimUsdt =
        result.ladder?.needsUsdtClaim &&
        result.ladder.usdtPending != null &&
        result.ladder.usdtPending > 0
          ? {
              day: result.day,
              campaignId: result.campaignId,
              checkInTx: "",
              amountUsdt: result.ladder.usdtPending,
              createdAt: Date.now(),
            }
          : null;

      if (claimUsdt) {
        try {
          const pending = await fetchPendingStreakUsdt(walletAddress);
          setUsdtPayoutsEnabled(pending.payoutsEnabled);
          setPendingUsdt(pending.pending);
          const match =
            pending.pending.find((row) => row.day === result.day) ??
            pending.pending[0] ??
            null;
          if (match) {
            claimUsdt.checkInTx = match.checkInTx;
            claimUsdt.amountUsdt = match.amountUsdt;
          }
        } catch {
          // Claim CTA still shown from sync ladder payload
        }
      }

      const hours = result.ladder?.infiniteHoursGranted;
      const isFinale =
        complete.day >= STREAK_LADDER_REQUIRED_DAYS ||
        (Boolean(result.milestone) && !ladderV2);
      const rewardLine = dayReward
        ? formatStreakRewardDetail(dayReward)
        : null;
      const nextDay = Math.min(complete.day + 1, STREAK_LADDER_REQUIRED_DAYS);

      let title = "You're signed in!";
      let body = `Day ${complete.day} is locked in. Come back in 24 hours to keep your streak going!`;

      if (result.alreadySignedIn) {
        title = "You're signed in!";
        body =
          complete.day > 0
            ? `Welcome back — Day ${complete.day} is already counted for today. Jump in and play!`
            : "Welcome back to ArcadeX. You're all set for today!";
      } else if (isFinale) {
        title = "You're signed in!";
        body = rewardLine
          ? `Streak complete — Day ${complete.day}: ${rewardLine}. Amazing run!`
          : `Day ${complete.day} locked in. Streak complete — amazing run!`;
      } else if (sparkGranted) {
        title = "You're signed in!";
        body = hours
          ? `Day ${complete.day} locked in. Infinite Spark is on for ${hours}h — come back later for Day ${nextDay}!`
          : `Day ${complete.day} locked in. Infinite Spark is on for 24h — come back later for Day ${nextDay}!`;
      } else if (claimUsdt) {
        title = "You're signed in!";
        body = `Day ${complete.day} locked in — ${formatUsdtAmount(claimUsdt.amountUsdt)} ready to claim. Come back later for Day ${nextDay}!`;
      } else if (rewardLine) {
        title = "You're signed in!";
        body = `Day ${complete.day} locked in — ${rewardLine}. Come back in 24 hours for Day ${nextDay}!`;
      }

      setSuccess({
        title,
        body,
        claimUsdt,
      });
    } catch (err) {
      setError(formatChainError(err) || "Check-in failed. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleClaimUsdt(item: StreakUsdtPendingItem) {
    playTouchSfx();
    setClaimingUsdt(true);
    setError("");
    try {
      const result = await claimStreakUsdt({
        walletAddress,
        checkInTx: item.checkInTx || undefined,
      });
      playSuccessSfx();
      setPendingUsdt((prev) =>
        prev.filter((row) => row.checkInTx !== item.checkInTx)
      );
      setSuccess({
        title: "USDT claimed!",
        body: `${formatUsdtAmount(result.amountUsdt)} is on its way. Come back tomorrow to keep your streak going!`,
        claimUsdt: null,
      });
    } catch (err) {
      setError(formatChainError(err) || "USDT claim failed. Try again.");
    } finally {
      setClaimingUsdt(false);
    }
  }

  function renderDayNode(day: number) {
    const state = dayNodeState(day, currentDay, checkInDay, wouldReset);
    const reward = ladderV2 ? getStreakDayReward(day) : null;
    const highlight = ladderV2
      ? Boolean(reward && isStreakHighlightDay(reward))
      : day === requiredDays;
    const glyph = ladderV2
      ? rewardGlyph(reward, state)
      : day === requiredDays
        ? "spark"
        : "xp";
    const isSelected = selectedDay === day;
    const tappable = ladderV2;
    const caption =
      ladderV2 && reward
        ? state === "done"
          ? "Claimed"
          : formatDayColumnCaption(reward)
        : null;

    const rewardGlyphNode =
      state === "done" ? (
        <span className="daily-checkin-check">
          <CheckIcon />
        </span>
      ) : glyph === "usdt" ? (
        <UsdtGlyphIcon className="daily-checkin-day-glyph" />
      ) : glyph === "spark" ? (
        <SparkBoltIcon className="daily-checkin-day-glyph" />
      ) : glyph === "gift" ? (
        <GiftIcon className="daily-checkin-day-glyph" />
      ) : ladderV2 ? (
        <XpIcon className="daily-checkin-day-glyph" />
      ) : (
        <span className="daily-checkin-day-num">{day}</span>
      );

    const nodeInner = ladderV2 ? (
      <>
        <div className="daily-checkin-day-card">
          <div className="daily-checkin-day-node">{rewardGlyphNode}</div>
          {caption ? (
            <span className="daily-checkin-day-caption">{caption}</span>
          ) : null}
          {state === "today" ? (
            <span className="daily-checkin-day-today">Today</span>
          ) : (
            <span className="daily-checkin-day-label">D{day}</span>
          )}
        </div>
        <span
          className={`daily-checkin-day-rail-mark daily-checkin-day-rail-mark--${state}`}
          aria-hidden
        >
          {state === "done" ? <CheckIcon /> : null}
        </span>
      </>
    ) : (
      <>
        <div className="daily-checkin-day-node">{rewardGlyphNode}</div>
        {state === "today" ? (
          <span className="daily-checkin-day-today">Today</span>
        ) : (
          <span className="daily-checkin-day-label">D{day}</span>
        )}
      </>
    );

    const className = `daily-checkin-day daily-checkin-day--${state}${
      highlight ? " daily-checkin-day--milestone" : ""
    }${glyph === "usdt" ? " daily-checkin-day--usdt" : ""}${
      glyph === "spark" ? " daily-checkin-day--spark" : ""
    }${glyph === "xp" && ladderV2 ? " daily-checkin-day--xp" : ""}${
      glyph === "gift" ? " daily-checkin-day--gift" : ""
    }${isSelected ? " daily-checkin-day--peeked" : ""}${
      tappable ? " daily-checkin-day--tappable" : ""
    }`;

    if (tappable) {
      return (
        <button
          key={day}
          type="button"
          data-streak-day={day}
          className={className}
          aria-pressed={isSelected}
          aria-label={
            reward
              ? `Day ${day}: ${formatStreakRewardDetail(reward)}`
              : `Day ${day}`
          }
          onClick={() => {
            playTouchSfx();
            setSelectedDay((prev) => (prev === day ? null : day));
          }}
        >
          {nodeInner}
        </button>
      );
    }

    return (
      <div key={day} data-streak-day={day} className={className}>
        {nodeInner}
      </div>
    );
  }

  return createPortal(
    <>
      <div className="player-modal-backdrop" role="dialog" aria-modal="true">
        <div
          className={`player-modal daily-checkin-modal${
            ladderV2 ? " daily-checkin-modal--ladder-v2" : ""
          }`}
        >
          <h2 className="daily-checkin-heading">
            {ladderV2 ? null : (
              <FlameIcon className="daily-checkin-heading-flame" />
            )}
            {ladderV2 ? "30 Days Streak" : "Daily Streak"}
            {ladderV2 ? null : (
              <FlameIcon className="daily-checkin-heading-flame" />
            )}
          </h2>
          <p className="daily-checkin-sub">
            {ladderV2 ? (
              <>
                Open ArcadeX daily to keep your streak alive and earn{" "}
                <span className="daily-checkin-sub-accent">
                  USDT, XP, Infinite game play
                </span>
              </>
            ) : (
              <>
                Check in once every 24 hours to keep your streak alive and earn{" "}
                <span className="daily-checkin-sub-accent">Infinite Spark.</span>
              </>
            )}
          </p>

          {ladderV2 ? (
            <section
              className="daily-checkin-carousel"
              aria-label={`${requiredDays}-day streak progress`}
            >
              <div className="daily-checkin-days-panel">
                <div
                  ref={daysScrollRef}
                  className="daily-checkin-days-scroll"
                  role="list"
                  onScroll={() => syncPageFromScroll()}
                >
                  {days.map((day) => renderDayNode(day))}
                </div>

                <div className="daily-checkin-carousel-nav daily-checkin-carousel-nav--embedded">
                  <button
                    type="button"
                    className="daily-checkin-carousel-arrow"
                    aria-label="Previous days"
                    disabled={safePage <= 0}
                    onClick={() => {
                      playTouchSfx();
                      scrollToPage(safePage - 1);
                    }}
                  >
                    <ChevronIcon dir="left" />
                  </button>
                  <div className="daily-checkin-carousel-dots" aria-hidden>
                    {Array.from({ length: pageCount }, (_, i) => (
                      <button
                        key={i}
                        type="button"
                        className={`daily-checkin-carousel-dot${
                          i === safePage
                            ? " daily-checkin-carousel-dot--active"
                            : ""
                        }`}
                        aria-label={`Page ${i + 1}`}
                        onClick={() => {
                          playTouchSfx();
                          scrollToPage(i);
                        }}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    className="daily-checkin-carousel-arrow"
                    aria-label="Next days"
                    disabled={safePage >= pageCount - 1}
                    onClick={() => {
                      playTouchSfx();
                      scrollToPage(safePage + 1);
                    }}
                  >
                    <ChevronIcon dir="right" />
                  </button>
                </div>

                <section className="daily-checkin-next-reward daily-checkin-next-reward--embedded">
                  <div
                    className={`daily-checkin-next-reward-icon daily-checkin-reward-icon--${rewardIconKind}`}
                    aria-hidden
                  >
                    {rewardIconKind === "usdt" ? (
                      <UsdtGlyphIcon />
                    ) : rewardIconKind === "spark" ? (
                      <SparkBoltIcon />
                    ) : rewardIconKind === "gift" ? (
                      <GiftIcon />
                    ) : (
                      <XpIcon />
                    )}
                  </div>
                  <div className="daily-checkin-next-reward-copy">
                    <p className="daily-checkin-section-label">Next Reward</p>
                    <p className="daily-checkin-next-reward-line">
                      {nextRewardTitle}
                    </p>
                  </div>
                  <span className="daily-checkin-reward-badge">
                    {nextRewardBadge}
                  </span>
                </section>
              </div>

              <p className="daily-checkin-days-scroll-hint">
                Tap a day to view reward · Swipe for D1–D{requiredDays}
              </p>
            </section>
          ) : (
            <section
              className="daily-checkin-timeline"
              aria-label={`${requiredDays}-day streak progress`}
            >
              {days.map((day) => renderDayNode(day))}
            </section>
          )}

          <section
            className={`daily-checkin-hero-card${
              ladderV2 ? " daily-checkin-hero-card--compact" : ""
            }`}
          >
            {!ladderV2 ? (
              <div className="daily-checkin-hero-flame" aria-hidden>
                <FlameIcon />
              </div>
            ) : (
              <div className="daily-checkin-hero-ambiance" aria-hidden>
                <span className="daily-checkin-hero-blob daily-checkin-hero-blob--a" />
                <span className="daily-checkin-hero-blob daily-checkin-hero-blob--b" />
              </div>
            )}
            <div className="daily-checkin-hero-copy">
              <p className="daily-checkin-section-label daily-checkin-section-label--light">
                Your streak
              </p>
              <p className="daily-checkin-streak-value">
                {displayStreak > 0 ? (
                  <>
                    <span className="daily-checkin-streak-num">
                      {displayStreak}
                    </span>{" "}
                    <span className="daily-checkin-streak-unit">
                      Day{displayStreak === 1 ? "" : "s"}
                    </span>
                  </>
                ) : (
                  <span className="daily-checkin-streak-unit">Start today</span>
                )}
              </p>
              <p className="daily-checkin-streak-hint">{streakHint}</p>
            </div>
          </section>

          {!ladderV2 ? (
            <section className="daily-checkin-reward-card">
              <div className="daily-checkin-reward-row">
                <div
                  className={`daily-checkin-reward-icon daily-checkin-reward-icon--${rewardIconKind}`}
                  aria-hidden
                >
                  <SparkBoltIcon />
                </div>
                <div className="daily-checkin-reward-copy">
                  <p className="daily-checkin-section-label">Next reward</p>
                  <p className="daily-checkin-reward-title">{nextRewardTitle}</p>
                  <p className="daily-checkin-reward-detail">
                    Infinite Spark · 24 hours
                  </p>
                </div>
                <span className="daily-checkin-reward-badge">{nextRewardBadge}</span>
              </div>
            </section>
          ) : null}

          {error ? <p className="daily-checkin-error">{error}</p> : null}

          {ladderV2 && pendingUsdt.length > 0 ? (
            <button
              type="button"
              className="daily-checkin-btn daily-checkin-btn--claim"
              disabled={claimingUsdt || loading || !usdtPayoutsEnabled}
              onClick={() => {
                if (!usdtPayoutsEnabled) return;
                void handleClaimUsdt(pendingUsdt[0]!);
              }}
            >
              <span className="daily-checkin-btn-main">
                {claimingUsdt
                  ? "Claiming USDT…"
                  : usdtPayoutsEnabled
                    ? `Claim ${formatUsdtAmount(pendingUsdt[0]!.amountUsdt)}`
                    : `USDT ready · Day ${pendingUsdt[0]!.day}`}
              </span>
              <span className="daily-checkin-btn-sub">
                {usdtPayoutsEnabled
                  ? "No cost · sent to this wallet"
                  : "Payouts turn on at go-live"}
              </span>
            </button>
          ) : null}

          <button
            type="button"
            className="daily-checkin-btn"
            disabled={loading || !walletAddress || Boolean(success)}
            onClick={() => void handleCheckIn()}
          >
            <span className="daily-checkin-btn-main">
              <ShieldCheckIcon />
              {loading ? "Unlocking…" : "Daily Check In (No cost)"}
            </span>
            <span className="daily-checkin-btn-sub">No cost transaction</span>
          </button>
        </div>
      </div>
      {success ? (
        <div
          className="spark-success-backdrop"
          role="presentation"
          onClick={() => finishSuccess()}
        >
          <div
            className="spark-success-popup"
            role="alertdialog"
            aria-live="polite"
            aria-labelledby="daily-streak-success-title"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="spark-success-popup__icon" aria-hidden>
              ✓
            </span>
            <h3
              id="daily-streak-success-title"
              className="spark-success-popup__title"
            >
              {success.title}
            </h3>
            <p className="spark-success-popup__body">{success.body}</p>
            {success.claimUsdt && usdtPayoutsEnabled ? (
              <button
                type="button"
                className="spark-success-popup__btn"
                disabled={claimingUsdt}
                onClick={() => void handleClaimUsdt(success.claimUsdt!)}
              >
                {claimingUsdt
                  ? "Claiming…"
                  : `Claim ${formatUsdtAmount(success.claimUsdt.amountUsdt)}`}
              </button>
            ) : (
              <button
                type="button"
                className="spark-success-popup__btn"
                onClick={() => finishSuccess()}
              >
                Let&apos;s play
              </button>
            )}
            {success.claimUsdt && usdtPayoutsEnabled ? (
              <button
                type="button"
                className="spark-success-popup__btn spark-success-popup__btn--ghost"
                onClick={() => finishSuccess()}
                style={{ marginTop: 8, opacity: 0.85 }}
              >
                Let&apos;s play
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </>,
    document.body
  );
}
