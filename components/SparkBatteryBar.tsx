"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSparks } from "@/components/SparkProvider";
import { formatSparkCountdown, formatSparkDuration } from "@/lib/spark";

export default function SparkBatteryBar() {
  const { sparks, loading } = useSparks();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("keydown", handleKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const isFull = sparks.available >= sparks.max;
  const isEmpty = sparks.available === 0 && !sparks.hasInfinite;
  const fillClass = isFull
    ? "spark-battery__fill--full"
    : isEmpty
      ? "spark-battery__fill--empty"
      : "spark-battery__fill--partial";

  const segmentFills = useMemo(() => {
    const level = (sparks.fillPercent / 100) * sparks.max;
    return Array.from({ length: sparks.max }, (_, index) => {
      const filled = level - index;
      if (filled >= 1) return 100;
      if (filled > 0) return Math.round(filled * 100);
      return 0;
    });
  }, [sparks.fillPercent, sparks.max]);

  const panel = open ? (
    <div
      className="spark-panel-backdrop"
      onClick={() => setOpen(false)}
      role="presentation"
    >
      <div
        className="spark-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="spark-panel-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="spark-panel__close"
          onClick={() => setOpen(false)}
          aria-label="Close"
        >
          ×
        </button>

        <header className="spark-panel__header">
          <div className="spark-panel__title-row">
            <span className="spark-panel__title-icon" aria-hidden>
              ⚡
            </span>
            <h2 id="spark-panel-title" className="spark-panel__title">
              Sparks
            </h2>
          </div>
          <p className="spark-panel__intro">
            Use Sparks to play any game. Once inside, play freely and infinitely!
          </p>
        </header>

        {sparks.hasInfinite ? (
          <section className="spark-panel__status">
            <div className="spark-panel__count-row">
              <span className="spark-panel__count-icon" aria-hidden>
                ∞
              </span>
              <p className="spark-panel__count-text spark-panel__count-text--infinite">
                Infinite Spark active
              </p>
            </div>
            <p className="spark-panel__infinite-hint">
              Play any game freely — no Spark cost while this lasts.
            </p>
          </section>
        ) : (
          <section className="spark-panel__status">
            <div className="spark-panel__count-row">
              <span className="spark-panel__count-icon" aria-hidden>
                ⚡
              </span>
              <p className="spark-panel__count-text">
                <strong>{sparks.available}</strong>
                <span className="spark-panel__count-sep">/</span>
                {sparks.max} Sparks Available
              </p>
            </div>

            <div className="spark-panel__segments" aria-hidden>
              {segmentFills.map((fill, index) => (
                <div key={index} className="spark-panel__segment">
                  <span
                    className="spark-panel__segment-fill"
                    style={{ width: `${fill}%` }}
                  />
                </div>
              ))}
            </div>

            {isFull ? (
              <span className="spark-panel__badge">All Sparks are full! ✦</span>
            ) : (
              <div className="spark-panel__timer-box">
                <div className="spark-panel__timer-row">
                  <span className="spark-panel__timer-icon" aria-hidden>
                    ⏱
                  </span>
                  <p className="spark-panel__timer-label">
                    Next Spark in{" "}
                    <strong>{formatSparkCountdown(sparks.timeToNextMs)}</strong>
                  </p>
                </div>
                <p className="spark-panel__timer-sub">
                  All Sparks ready in{" "}
                  <strong>{formatSparkDuration(sparks.timeToFullMs)}</strong>
                </p>
              </div>
            )}

            <p className="spark-panel__info">
              <span aria-hidden>ℹ</span> 1 Spark = 1 game entry. Each Spark
              refills in 3 hours.
            </p>
          </section>
        )}

        <section className="spark-panel__shop">
          <h3 className="spark-panel__shop-title">
            <span aria-hidden>✦</span> Get More Sparks
          </h3>

          <div className="spark-shop-card">
            <div className="spark-shop-card__main">
              <span className="spark-shop-card__icon spark-shop-card__icon--refill" aria-hidden>
                ⚡
              </span>
              <div className="spark-shop-card__copy">
                <p className="spark-shop-card__name">Spark Refill</p>
                <p className="spark-shop-card__desc">
                  Instantly refill your Spark bar to full.
                </p>
              </div>
              <button type="button" className="spark-shop-card__price" disabled>
                $0.04
              </button>
            </div>
            <span className="spark-shop-card__tag spark-shop-card__tag--gold">
              Best for quick top-up
            </span>
          </div>

          <div className="spark-shop-card spark-shop-card--infinite">
            <div className="spark-shop-card__main">
              <span className="spark-shop-card__icon spark-shop-card__icon--infinite" aria-hidden>
                ∞
              </span>
              <div className="spark-shop-card__copy">
                <p className="spark-shop-card__name">Infinite Spark (24h)</p>
                <p className="spark-shop-card__desc">
                  Unlimited game access for 24 hours.
                </p>
              </div>
              <button type="button" className="spark-shop-card__price" disabled>
                $0.10
              </button>
            </div>
            <span className="spark-shop-card__tag spark-shop-card__tag--purple">
              Play without limits
            </span>
          </div>

          <p className="spark-panel__shop-note">
            <span aria-hidden>🛡</span> Infinite Spark removes the entry gate
            only. Weekly leaderboard attempt limits still apply.
          </p>
        </section>
      </div>
    </div>
  ) : null;

  return (
    <>
      <div className="spark-battery-wrap">
        <button
          type="button"
          className="spark-battery"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-label={`${sparks.available} of ${sparks.max} Sparks available`}
          disabled={loading}
        >
          <span className="spark-battery__bolt" aria-hidden>
            ⚡
          </span>
          <span className="spark-battery__shell">
            <span
              className={`spark-battery__fill ${fillClass}`}
              style={{ width: `${sparks.fillPercent}%` }}
            />
          </span>
          <span className="spark-battery__cap" aria-hidden />
        </button>
      </div>

      {typeof document !== "undefined" && panel
        ? createPortal(panel, document.body)
        : panel}
    </>
  );
}
