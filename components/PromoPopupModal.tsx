"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { formatContestCountdown } from "@/lib/contest";
import { SUPPORT_URL, TWITTER_URL } from "@/lib/app-footer-links";
import {
  getPromoBody,
  getPromoCtaLabel,
  getPromoTitle,
  type PromoPopupCandidate,
} from "@/lib/promo-popups";
import { playTouchSfx } from "@/lib/sfx";

interface PromoPopupModalProps {
  open: boolean;
  item: PromoPopupCandidate | null;
  imageUrl: string | null;
  onDismiss: () => void;
  onPrimary: () => void;
  onOpenTelegram?: () => void;
  onOpenTwitter?: () => void;
}

export default function PromoPopupModal({
  open,
  item,
  imageUrl,
  onDismiss,
  onPrimary,
  onOpenTelegram,
  onOpenTwitter,
}: PromoPopupModalProps) {
  const [mounted, setMounted] = useState(false);
  const [countdown, setCountdown] = useState("");

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open || !item?.endsAt) {
      setCountdown("");
      return;
    }
    const tick = () => {
      setCountdown(formatContestCountdown(item.endsAt! - Date.now()));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [open, item]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onDismiss]);

  if (!open || !mounted || !item) return null;

  const title = getPromoTitle(item);
  const body = getPromoBody(item);
  const cta = getPromoCtaLabel(item);
  const showTimer =
    (item.kind === "contestEnd" ||
      item.kind === "contestStart" ||
      item.kind === "weekEnd") &&
    Boolean(item.endsAt);
  const isCommunity = item.kind === "community";

  const modal = (
    <div className="promo-popup-backdrop" role="presentation">
      <div
        className="promo-popup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="promo-popup-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="promo-popup__close"
          aria-label="Dismiss"
          onClick={() => {
            playTouchSfx();
            onDismiss();
          }}
        >
          ✕
        </button>

        {isCommunity ? (
          <div className="promo-popup__social-row" aria-hidden={false}>
            <img
              src="/telegram-logo.svg"
              alt=""
              className="promo-popup__social-logo"
              width={72}
              height={72}
            />
            <img
              src="/x-logo.svg"
              alt=""
              className="promo-popup__social-logo"
              width={72}
              height={72}
            />
          </div>
        ) : imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            className="promo-popup__art"
            width={160}
            height={160}
          />
        ) : (
          <div className="promo-popup__art promo-popup__art--placeholder" aria-hidden />
        )}

        <h2 id="promo-popup-title" className="promo-popup__title">
          {title}
        </h2>

        {!isCommunity && item.gameName && item.kind !== "newGame" ? (
          <p className="promo-popup__game">{item.gameName}</p>
        ) : null}

        {item.kind === "newGame" && item.gameName ? (
          <p className="promo-popup__game">{item.gameName}</p>
        ) : null}

        <p className="promo-popup__body">{body}</p>

        {showTimer && countdown ? (
          <p className="promo-popup__timer" role="status">
            <span className="promo-popup__timer-label">Time left</span>
            <span className="promo-popup__timer-value">{countdown}</span>
          </p>
        ) : null}

        {isCommunity ? (
          <div className="promo-popup__actions promo-popup__actions--split">
            <a
              className="promo-popup__btn promo-popup__btn--telegram"
              href={SUPPORT_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                playTouchSfx();
                onOpenTelegram?.();
              }}
            >
              Telegram
            </a>
            <a
              className="promo-popup__btn promo-popup__btn--x"
              href={TWITTER_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                playTouchSfx();
                onOpenTwitter?.();
              }}
            >
              Follow on X
            </a>
          </div>
        ) : (
          <button
            type="button"
            className="promo-popup__btn"
            onClick={() => {
              playTouchSfx();
              onPrimary();
            }}
          >
            {cta}
          </button>
        )}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
