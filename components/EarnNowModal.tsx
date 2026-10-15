"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { GAME_OPEN_CLAIM_USDT } from "@/lib/game-open-claim";
import { useClaimUiOverlay } from "@/lib/use-ui-overlay-gate";

interface EarnNowModalProps {
  open: boolean;
  onClose: () => void;
  onClaimNow: () => void;
}

export default function EarnNowModal({
  open,
  onClose,
  onClaimNow,
}: EarnNowModalProps) {
  useClaimUiOverlay("earn-now", open);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const amountLabel = `$${GAME_OPEN_CLAIM_USDT.toFixed(3)} USDT`;

  return createPortal(
    <div
      className="earn-now-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="earn-now-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="earn-now-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="earn-now-modal__close"
          aria-label="Close"
          onClick={onClose}
        >
          ✕
        </button>
        <p className="earn-now-modal__eyebrow">Earn Now</p>
        <h2 id="earn-now-title" className="earn-now-modal__title">
          Open a game &amp; claim {amountLabel}
        </h2>
        <p className="earn-now-modal__body">
          Every live game has a one-time claim each day. Tap Claim $
          {GAME_OPEN_CLAIM_USDT.toFixed(3)} on the game screen to get rewarded,
          then play.
        </p>
        <button
          type="button"
          className="earn-now-modal__cta"
          onClick={onClaimNow}
        >
          Claim Now
        </button>
      </div>
    </div>,
    document.body
  );
}
