"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { formatGameOpenUsdt, GAME_OPEN_CLAIM_USDT } from "@/lib/game-open-claim";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
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

  const amountLabel = `$${formatGameOpenUsdt(GAME_OPEN_CLAIM_USDT)}`;

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
