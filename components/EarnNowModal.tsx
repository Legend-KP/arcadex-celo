"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { GAME_OPEN_CLAIM_POPUP_USDT } from "@/lib/game-open-claim";
import { useClaimUiOverlay } from "@/lib/use-ui-overlay-gate";

export const EARN_NOW_POPUP_IMAGE = "/earn-now-popup.jpg";
export const EARN_NOW_SESSION_KEY = "arcadex_earn_now_popup_shown";

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

  const amountLabel = `$${GAME_OPEN_CLAIM_POPUP_USDT.toFixed(2)}`;

  return createPortal(
    <div
      className="earn-now-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="earn-now-modal earn-now-modal--image"
        role="dialog"
        aria-modal="true"
        aria-label="Play games and claim USDT"
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
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="earn-now-modal__art"
          src={EARN_NOW_POPUP_IMAGE}
          alt="Play games, claim USDT"
          width={1024}
          height={682}
          decoding="async"
          fetchPriority="high"
        />
        <button
          type="button"
          className="earn-now-modal__cta"
          onClick={onClaimNow}
        >
          Claim {amountLabel}
        </button>
      </div>
    </div>,
    document.body
  );
}
