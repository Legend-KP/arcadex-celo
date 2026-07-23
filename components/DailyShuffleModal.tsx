"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { formatChainError } from "@/lib/celo-public-client";
import { DEFAULT_SHUFFLE_CAMPAIGN_ID } from "@/lib/daily-play-mode";
import {
  claimDailyShuffleReward,
  performDailyShuffle,
  type ShufflePrepareResult,
  type ShuffleTheaterCard,
} from "@/lib/shuffle-client";
import {
  fetchStreakStatus,
  refreshSessionFromCheckIn,
  type StreakStatus,
} from "@/lib/streak-client";

type Phase =
  | "intro"
  | "busy"
  | "showcase"
  | "shuffling"
  | "pick"
  | "reveal"
  | "claiming"
  | "done";

interface DailyShuffleModalProps {
  open: boolean;
  walletAddress: string;
  status: StreakStatus | null;
  onComplete: (result: {
    day: number;
    milestone: boolean;
    infiniteSparkGranted: boolean;
  }) => void;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function DailyShuffleModal({
  open,
  walletAddress,
  status,
  onComplete,
}: DailyShuffleModalProps) {
  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<Phase>("intro");
  const [error, setError] = useState("");
  const [theater, setTheater] = useState<ShuffleTheaterCard[]>([]);
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ShufflePrepareResult["outcome"] | null>(
    null
  );
  const [needsClaim, setNeedsClaim] = useState(false);
  const [infiniteSparkGranted, setInfiniteSparkGranted] = useState(false);
  const [pickedId, setPickedId] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) {
      setPhase("intro");
      setError("");
      setTheater([]);
      setWinnerId(null);
      setOutcome(null);
      setNeedsClaim(false);
      setPickedId(null);
    }
  }, [open]);

  const winnerCard = useMemo(
    () => theater.find((c) => c.id === winnerId) ?? null,
    [theater, winnerId]
  );

  async function recoverIfAlreadyDone() {
    const fresh = await fetchStreakStatus(
      walletAddress,
      DEFAULT_SHUFFLE_CAMPAIGN_ID,
      { fresh: true }
    );
    if (!fresh.canCheckIn && fresh.lastCheckInAt > 0) {
      await refreshSessionFromCheckIn(
        walletAddress,
        DEFAULT_SHUFFLE_CAMPAIGN_ID
      );
      onComplete({
        day: fresh.currentDay || 1,
        milestone: false,
        infiniteSparkGranted: false,
      });
      return true;
    }
    return false;
  }

  async function handleShuffle() {
    if (phase !== "intro" && phase !== "done") return;
    setError("");
    setPhase("busy");

    try {
      const { prepare, sync } = await performDailyShuffle(
        walletAddress,
        DEFAULT_SHUFFLE_CAMPAIGN_ID
      );

      setTheater(prepare.theater);
      setWinnerId(prepare.outcome.id);
      setOutcome(prepare.outcome);
      setNeedsClaim(Boolean(sync.needsClaim));
      setInfiniteSparkGranted(Boolean(sync.infiniteSparkGranted));

      setPhase("showcase");
      await sleep(1600);
      setPhase("shuffling");
      await sleep(1400);
      setPhase("pick");
    } catch (err) {
      try {
        if (await recoverIfAlreadyDone()) return;
      } catch {
        // keep original error
      }
      setError(formatChainError(err));
      setPhase("intro");
    }
  }

  function handlePick(cardId: string) {
    if (phase !== "pick" || !winnerId) return;
    setPickedId(cardId);
    // Theater only — always reveal the server outcome.
    setPhase("reveal");
  }

  async function handleContinue() {
    if (needsClaim) {
      setPhase("claiming");
      setError("");
      try {
        await claimDailyShuffleReward(DEFAULT_SHUFFLE_CAMPAIGN_ID);
        setNeedsClaim(false);
        setPhase("done");
        onComplete({
          day: 1,
          milestone: outcome?.type === "spark",
          infiniteSparkGranted,
        });
      } catch (err) {
        setError(formatChainError(err));
        setPhase("reveal");
      }
      return;
    }

    onComplete({
      day: 1,
      milestone: outcome?.type === "spark",
      infiniteSparkGranted,
    });
  }

  if (!mounted || !open) return null;

  return createPortal(
    <div className="player-modal-backdrop daily-shuffle-backdrop" role="presentation">
      <div
        className="daily-shuffle-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="daily-shuffle-title"
      >
        <p className="daily-shuffle-eyebrow">Daily play</p>
        <h2 id="daily-shuffle-title" className="daily-shuffle-title">
          Daily Shuffle
        </h2>
        <p className="daily-shuffle-sub">
          One free shuffle every 24 hours. Same sign-in as always — cards are
          just the reveal.
        </p>

        {phase === "intro" || phase === "busy" ? (
          <div className="daily-shuffle-hero">
            <div className="daily-shuffle-hero-card">
              <span className="daily-shuffle-hero-glyph">⚡</span>
              <strong>Tap to shuffle</strong>
              <span>USDT · Infinite Spark · or try again tomorrow</span>
            </div>
            {status && !status.canCheckIn ? (
              <p className="daily-shuffle-hint">
                Already shuffled today — restoring your session…
              </p>
            ) : null}
          </div>
        ) : null}

        {(phase === "showcase" ||
          phase === "shuffling" ||
          phase === "pick" ||
          phase === "reveal" ||
          phase === "claiming") && (
          <div className="daily-shuffle-stage">
            {phase === "shuffling" ? (
              <div className="daily-shuffle-pile" aria-live="polite">
                <span>Shuffling…</span>
                <div className="daily-shuffle-pile-cards">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="daily-shuffle-pile-card" />
                  ))}
                </div>
              </div>
            ) : (
              <div
                className={`daily-shuffle-grid ${
                  phase === "pick" ? "is-pick" : ""
                } ${phase === "reveal" || phase === "claiming" ? "is-reveal" : ""}`}
              >
                {theater.map((card) => {
                  const isWinner = card.id === winnerId;
                  const faceDown = phase === "pick";
                  const showFront =
                    phase === "showcase" ||
                    ((phase === "reveal" || phase === "claiming") && isWinner);
                  return (
                    <button
                      key={card.id}
                      type="button"
                      className={`daily-shuffle-card rarity-${card.rarity} ${
                        faceDown ? "is-back" : ""
                      } ${
                        phase === "reveal" || phase === "claiming"
                          ? isWinner
                            ? "is-winner"
                            : "is-loser"
                          : ""
                      } ${pickedId === card.id ? "is-picked" : ""}`}
                      disabled={phase !== "pick"}
                      onClick={() => handlePick(card.id)}
                    >
                      {showFront ? (
                        <>
                          <span className="daily-shuffle-card-glyph">
                            {card.glyph}
                          </span>
                          <span className="daily-shuffle-card-label">
                            {card.type === "usdt" && card.amount != null
                              ? `${card.amount} USDT`
                              : card.label}
                          </span>
                          <span className="daily-shuffle-card-sub">
                            {card.sub}
                          </span>
                        </>
                      ) : (
                        <span className="daily-shuffle-card-mark">?</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {(phase === "reveal" || phase === "claiming") && winnerCard ? (
          <div className="daily-shuffle-result">
            <p className="daily-shuffle-result-title">
              {outcome?.type === "usdt"
                ? "You won!"
                : outcome?.type === "spark"
                  ? "Infinite Spark!"
                  : winnerCard.label}
            </p>
            <p className="daily-shuffle-result-amt">
              {outcome?.type === "usdt" && outcome.amount != null
                ? `${outcome.amount} USDT`
                : outcome?.type === "spark"
                  ? "Unlimited plays · 24h"
                  : "Come back tomorrow for another shot."}
            </p>
          </div>
        ) : null}

        {error ? <p className="daily-shuffle-error">{error}</p> : null}

        <div className="daily-shuffle-actions">
          {phase === "intro" || phase === "busy" ? (
            <button
              type="button"
              className="daily-shuffle-cta"
              disabled={phase === "busy"}
              onClick={() => void handleShuffle()}
            >
              {phase === "busy" ? "Confirm in MiniPay…" : "Shuffle now · Free"}
            </button>
          ) : null}

          {phase === "pick" ? (
            <p className="daily-shuffle-hint">Pick a card to reveal today&apos;s reward</p>
          ) : null}

          {phase === "reveal" || phase === "claiming" ? (
            <button
              type="button"
              className="daily-shuffle-cta"
              disabled={phase === "claiming"}
              onClick={() => void handleContinue()}
            >
              {phase === "claiming"
                ? "Claiming USDT…"
                : needsClaim
                  ? "Claim USDT"
                  : "Continue"}
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}
