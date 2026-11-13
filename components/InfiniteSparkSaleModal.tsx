"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { INFINITE_SPARK_SALE_POSTER } from "@/lib/infinite-spark-sale";
import { playTouchSfx } from "@/lib/sfx";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { useClaimUiOverlay } from "@/lib/use-ui-overlay-gate";

export const INFINITE_SPARK_SALE_OVERLAY_ID = "infinite-spark-sale";

interface InfiniteSparkSaleModalProps {
  open: boolean;
  onClose: () => void;
  onGrabIt: () => void;
}

export default function InfiniteSparkSaleModal({
  open,
  onClose,
  onGrabIt,
}: InfiniteSparkSaleModalProps) {
  useClaimUiOverlay(INFINITE_SPARK_SALE_OVERLAY_ID, open);
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="earn-now-backdrop infinite-spark-sale-backdrop"
      role="presentation"
      onClick={() => {
        playTouchSfx();
        onClose();
      }}
    >
      <div
        className="earn-now-modal earn-now-modal--image infinite-spark-sale-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Infinite Spark 7-day sale"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="earn-now-modal__close"
          aria-label="Close"
          onClick={() => {
            playTouchSfx();
            onClose();
          }}
        >
          ✕
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="earn-now-modal__art"
          src={INFINITE_SPARK_SALE_POSTER}
          alt="Infinite Spark 7-day sale — unlimited game access for 50% off"
          width={1024}
          height={1365}
          decoding="async"
          fetchPriority="high"
        />
        <button
          type="button"
          className="earn-now-modal__cta infinite-spark-sale-modal__cta"
          onClick={() => {
            playTouchSfx();
            onGrabIt();
          }}
        >
          Grab it
        </button>
      </div>
    </div>,
    document.body
  );
}
