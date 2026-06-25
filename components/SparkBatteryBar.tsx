"use client";

import { useEffect, useRef, useState } from "react";
import { useSparks } from "@/components/SparkProvider";
import { formatSparkDuration } from "@/lib/spark";

export default function SparkBatteryBar() {
  const { sparks, loading } = useSparks();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const isFull = sparks.available >= sparks.max;
  const isEmpty = sparks.available === 0 && !sparks.hasInfinite;
  const fillClass = isFull
    ? "spark-battery__fill--full"
    : isEmpty
      ? "spark-battery__fill--empty"
      : "spark-battery__fill--partial";

  return (
    <div className="spark-battery-wrap" ref={rootRef}>
      <button
        type="button"
        className="spark-battery"
        onClick={() => setOpen((prev) => !prev)}
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

      {open && (
        <div className="spark-detail" role="dialog" aria-label="Spark status">
          <div className="spark-detail__header">
            <span className="spark-detail__icon" aria-hidden>
              ⚡
            </span>
            <span className="spark-detail__title">Sparks</span>
          </div>

          {sparks.hasInfinite ? (
            <>
              <p className="spark-detail__count spark-detail__count--infinite">
                Infinite Spark active
              </p>
              <p className="spark-detail__hint">
                Play any game freely — no Spark cost while this lasts.
              </p>
            </>
          ) : (
            <>
              <p className="spark-detail__count">
                <strong>{sparks.available}</strong>
                <span className="spark-detail__count-sep">/</span>
                {sparks.max} available
              </p>
              <p className="spark-detail__timer">
                {isFull ? (
                  "All Sparks ready!"
                ) : (
                  <>
                    Full in{" "}
                    <strong>{formatSparkDuration(sparks.timeToFullMs)}</strong>
                  </>
                )}
              </p>
              <p className="spark-detail__hint">
                1 Spark = 1 game entry. Each Spark refills in 3 hours.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
