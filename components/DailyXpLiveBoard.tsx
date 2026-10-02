"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import { claimShuffleRewardOnChain } from "@/lib/arcadex-rewards-spin";
import {
  getDailyXpLeaderboard,
  performDailyXpClaim,
  type DailyXpBoardResponse,
} from "@/lib/daily-xp-client";
import {
  DAILY_XP_CAMPAIGN_ID,
  DAILY_XP_GO_LIVE_AT_MS,
  DAILY_XP_REWARD_USDT,
  DAILY_XP_THRESHOLD,
  formatDailyXpCountdown,
  formatDailyXpStartsIn,
  isDailyXpLive,
  isDailyXpTransition,
} from "@/lib/daily-xp-board";
import { gameAssetCandidates } from "@/lib/game-assets";
import { readCachedGamesList } from "@/lib/games-list-client-cache";
import { fetchHomeShell } from "@/lib/home-client";
import { Game, gameIsLive, gameIsTest } from "@/types";

interface DailyXpLiveBoardProps {
  compact?: boolean;
  hideClose?: boolean;
  onClose?: () => void;
  /** Navigate to home catalog (drawer view / sheet). */
  onGoHome?: () => void;
}

type PromptKind = "under_threshold" | "no_check_in" | null;

const TIP_ROWS = [
  {
    icon: "⚡",
    tone: "play",
    title: "Play a game",
    xp: "+10 XP each time",
  },
  {
    icon: "🏆",
    tone: "score",
    title: "Submit your score",
    xp: "+10 XP each time",
  },
  {
    icon: "✓",
    tone: "checkin",
    title: "Daily check-in",
    xp: "+10 XP once per day",
  },
  {
    icon: "♾️",
    tone: "infinite",
    title: "Infinite Spark",
    xp: "+20 XP",
  },
  {
    icon: "🔋",
    tone: "refill",
    title: "Spark Refill",
    xp: "+10 XP",
  },
] as const;

function GameThumb({ game }: { game: Game }) {
  const candidates = useMemo(
    () => [
      ...gameAssetCandidates(game, "logo"),
      ...gameAssetCandidates(game, "thumbnail"),
    ],
    [game]
  );
  const [idx, setIdx] = useState(0);
  const src = candidates[idx] ?? candidates[0];

  if (!src) {
    return <span className="daily-xp-board__game-fallback">{game.name[0]}</span>;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- static/CDN game art
    <img
      className="daily-xp-board__game-img"
      src={src}
      alt=""
      draggable={false}
      onError={() => {
        if (idx + 1 < candidates.length) setIdx((v) => v + 1);
      }}
    />
  );
}

export default function DailyXpLiveBoard({
  compact = false,
  hideClose = false,
  onClose,
  onGoHome,
}: DailyXpLiveBoardProps) {
  const router = useRouter();
  const { walletAddress } = usePlayerProfile();
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimMsg, setClaimMsg] = useState<string | null>(null);
  const [tipsOpen, setTipsOpen] = useState(false);
  const [prompt, setPrompt] = useState<PromptKind>(null);
  const [me, setMe] = useState<DailyXpBoardResponse["me"]>(null);
  const [threshold, setThreshold] = useState(DAILY_XP_THRESHOLD);
  const [dayEndsAt, setDayEndsAt] = useState(0);
  const [resetCountdown, setResetCountdown] = useState("");
  const [live, setLive] = useState(() => isDailyXpLive());
  const [startsIn, setStartsIn] = useState(() =>
    formatDailyXpStartsIn(DAILY_XP_GO_LIVE_AT_MS - Date.now())
  );
  const [games, setGames] = useState<Game[]>(() => {
    const cached = readCachedGamesList()?.games ?? [];
    return cached.filter(
      (g) => gameIsLive(g) && g.active !== false && !gameIsTest(g)
    );
  });

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (isDailyXpTransition()) {
        setMe(null);
        setDayEndsAt(0);
        setThreshold(DAILY_XP_THRESHOLD);
      } else {
        const data = await getDailyXpLeaderboard({
          walletAddress: walletAddress || undefined,
        });
        setMe(data.me);
        setThreshold(data.threshold ?? DAILY_XP_THRESHOLD);
        setDayEndsAt(data.endsAtMs || data.endsAt || 0);
        if (data.resetsIn) setResetCountdown(data.resetsIn);
      }
    } catch (err) {
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
    let cancelled = false;
    async function loadGames() {
      try {
        const data = await fetchHomeShell();
        if (cancelled) return;
        const next = (data.games ?? []).filter(
          (g) => gameIsLive(g) && g.active !== false && !gameIsTest(g)
        );
        setGames(next);
      } catch {
        // Keep cached list.
      }
    }
    void loadGames();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const tick = () => {
      const remaining = DAILY_XP_GO_LIVE_AT_MS - Date.now();
      if (remaining <= 0) {
        setLive(true);
        setStartsIn("00:00:00");
        return;
      }
      setLive(false);
      setStartsIn(formatDailyXpStartsIn(remaining));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!live) {
      // After flip to live, refresh XP state once.
      return;
    }
    void reload();
  }, [live, reload]);

  useEffect(() => {
    if (!dayEndsAt) {
      setResetCountdown("");
      return;
    }
    const tick = () => {
      setResetCountdown(formatDailyXpCountdown(dayEndsAt - Date.now()));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [dayEndsAt]);

  function goHome() {
    onClose?.();
    if (onGoHome) {
      onGoHome();
      return;
    }
    router.push("/");
  }

  function openGame(gameId: string) {
    onClose?.();
    router.push(`/game/${gameId}`);
  }

  async function runClaim() {
    if (!walletAddress || claiming) return;
    setClaiming(true);
    setClaimMsg(null);
    setError(null);
    try {
      if (me?.claimed) {
        await claimShuffleRewardOnChain(DAILY_XP_CAMPAIGN_ID);
      } else {
        await performDailyXpClaim(walletAddress);
      }
      setClaimMsg("0.02 USDT claimed!");
      setPrompt(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Claim failed.");
    } finally {
      setClaiming(false);
    }
  }

  function handlePrimaryClick() {
    if (!live) return;
    setError(null);
    setClaimMsg(null);

    if (me?.claimed) {
      void runClaim();
      return;
    }

    const xp = me?.score ?? 0;
    if (xp < threshold) {
      setPrompt("under_threshold");
      return;
    }
    if (!me?.checkedIn) {
      setPrompt("no_check_in");
      return;
    }
    void runClaim();
  }

  const xp = live ? me?.score ?? 0 : 0;
  const progressPct = Math.min(100, Math.round((xp / threshold) * 100));
  const rewardLabel = `$${DAILY_XP_REWARD_USDT.toFixed(2)} USDT`;

  return (
    <div
      className={`daily-xp-board${compact ? " daily-xp-board--compact" : ""}`}
    >
      {!hideClose && onClose ? (
        <div className="daily-xp-board__top">
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

      <section className="daily-xp-board__reward">
        <p className="daily-xp-board__eyebrow">Daily reward</p>
        <div className="daily-xp-board__reward-row">
          <p className="daily-xp-board__reward-amount">{rewardLabel}</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="daily-xp-board__usdt"
            src="/tether-usdt-logo.png"
            alt=""
            draggable={false}
          />
        </div>
        <p className="daily-xp-board__reward-copy">
          Reach {threshold} XP today → Claim your reward
        </p>
      </section>

      <section className="daily-xp-board__progress" aria-label="Today's progress">
        <div className="daily-xp-board__progress-head">
          <span>Today&apos;s Progress</span>
          <span className="daily-xp-board__progress-mid">
            {loading && live ? "…" : `${xp} / ${threshold} XP`}
          </span>
          <span className="daily-xp-board__progress-pct">{progressPct}%</span>
        </div>
        <div className="daily-xp-board__progress-bar" aria-hidden>
          <span style={{ width: `${progressPct}%` }} />
        </div>
        {live && resetCountdown ? (
          <p className="daily-xp-board__reset">Resets in {resetCountdown}</p>
        ) : null}
      </section>

      <section className="daily-xp-board__earn">
        <div className="daily-xp-board__earn-head">
          <h3 className="daily-xp-board__section-title">How to Earn XP</h3>
          <button
            type="button"
            className="daily-xp-board__tips-btn"
            aria-label="XP tips"
            onClick={() => setTipsOpen(true)}
          >
            ?
          </button>
        </div>
        <div className="daily-xp-board__earn-grid">
          <div className="daily-xp-board__earn-card daily-xp-board__earn-card--play">
            <span className="daily-xp-board__earn-icon" aria-hidden>
              🎮
            </span>
            <span className="daily-xp-board__earn-title">Play a game</span>
            <span className="daily-xp-board__earn-xp">+10 XP each time</span>
          </div>
          <div className="daily-xp-board__earn-card daily-xp-board__earn-card--score">
            <span className="daily-xp-board__earn-icon" aria-hidden>
              🏆
            </span>
            <span className="daily-xp-board__earn-title">Submit your score</span>
            <span className="daily-xp-board__earn-xp">+10 XP each time</span>
          </div>
        </div>
      </section>

      <div className="daily-xp-board__cta-wrap">
        {!live ? (
          <button type="button" className="daily-xp-board__cta" disabled>
            Starts in {startsIn}
          </button>
        ) : (
          <button
            type="button"
            className="daily-xp-board__cta"
            disabled={claiming}
            onClick={handlePrimaryClick}
          >
            {claiming
              ? "Claiming…"
              : me?.claimed
                ? "Claim USDT"
                : "Claim now"}
          </button>
        )}

        {prompt === "under_threshold" ? (
          <div className="daily-xp-board__prompt" role="status">
            <p>Play games and earn XP to claim your reward.</p>
            <button
              type="button"
              className="daily-xp-board__cta daily-xp-board__cta--secondary"
              onClick={goHome}
            >
              ▶ Play Games
            </button>
          </div>
        ) : null}

        {prompt === "no_check_in" ? (
          <div className="daily-xp-board__prompt daily-xp-board__prompt--warn" role="status">
            <p>You haven&apos;t checked in yet. Check in today to claim.</p>
          </div>
        ) : null}

        {claimMsg ? (
          <p className="daily-xp-board__ok">{claimMsg}</p>
        ) : null}
        {error ? <p className="daily-xp-board__err">{error}</p> : null}

        <p className="daily-xp-board__banner">
          <span aria-hidden>🔥</span> Come back tomorrow to earn again!
        </p>
      </div>

      <section className="daily-xp-board__games">
        <div className="daily-xp-board__games-head">
          <h3 className="daily-xp-board__section-title">
            Play Games to earn XP
          </h3>
        </div>
        <ul className="daily-xp-board__game-list">
          {games.map((game) => (
            <li key={game.id}>
              <button
                type="button"
                className="daily-xp-board__game-row"
                onClick={() => openGame(game.id)}
              >
                <span className="daily-xp-board__game-thumb">
                  <GameThumb game={game} />
                </span>
                <span className="daily-xp-board__game-meta">
                  <span className="daily-xp-board__game-name">{game.name}</span>
                </span>
                <span className="daily-xp-board__game-xp">+10 XP</span>
                <span className="daily-xp-board__game-chevron" aria-hidden>
                  ›
                </span>
              </button>
            </li>
          ))}
          {games.length === 0 ? (
            <li className="daily-xp-board__games-empty">No playable games yet.</li>
          ) : null}
        </ul>
      </section>

      {tipsOpen ? (
        <div
          className="daily-xp-board__tips-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="How to earn XP"
          onClick={() => setTipsOpen(false)}
        >
          <div
            className="daily-xp-board__tips-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="daily-xp-board__tips-head">
              <h3>How to Earn XP</h3>
              <button
                type="button"
                className="lb-close"
                onClick={() => setTipsOpen(false)}
                aria-label="Close tips"
              >
                ✕
              </button>
            </div>
            <div className="daily-xp-board__tips-list">
              {TIP_ROWS.map((row) => (
                <div
                  key={row.title}
                  className={`daily-xp-board__earn-card daily-xp-board__earn-card--${row.tone} daily-xp-board__earn-card--tip`}
                >
                  <span className="daily-xp-board__earn-icon" aria-hidden>
                    {row.icon}
                  </span>
                  <span className="daily-xp-board__earn-title">{row.title}</span>
                  <span className="daily-xp-board__earn-xp">{row.xp}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
