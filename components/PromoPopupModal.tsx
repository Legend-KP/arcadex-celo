"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import ActivityLeaderboardPanel from "@/components/ActivityLeaderboardPanel";
import { SUPPORT_URL, TWITTER_URL } from "@/lib/app-footer-links";
import {
  getPromoBody,
  getPromoCtaLabel,
  getPromoTitle,
  isCommunityPromo,
  isLeaderboardPromo,
  isSparksUpgradePromo,
  type PromoPopupCandidate,
} from "@/lib/promo-popups";
import { playTouchSfx } from "@/lib/sfx";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";

interface PromoPopupModalProps {
  open: boolean;
  item: PromoPopupCandidate | null;
  /** Square art candidates (logo → thumbnail → fallback); advances on load error. */
  imageCandidates?: string[];
  /** @deprecated Prefer imageCandidates */
  imageUrl?: string | null;
  /** Unused for non-contest promos; kept for call-site compatibility. */
  accentColor?: string | null;
  onDismiss: () => void;
  onPrimary: () => void;
}

export default function PromoPopupModal({
  open,
  item,
  imageCandidates,
  imageUrl,
  onDismiss,
  onPrimary,
}: PromoPopupModalProps) {
  const [mounted, setMounted] = useState(false);
  const [imageIdx, setImageIdx] = useState(0);

  const candidates =
    imageCandidates && imageCandidates.length > 0
      ? imageCandidates
      : imageUrl
        ? [imageUrl]
        : [];
  const resolvedImage = candidates[imageIdx] ?? null;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setImageIdx(0);
  }, [item?.id, imageCandidates, imageUrl]);

  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onDismiss]);

  if (!open || !mounted || !item) return null;

  const title = getPromoTitle(item);
  const body = getPromoBody(item);
  const cta = getPromoCtaLabel(item);
  const community = isCommunityPromo(item.kind);
  const leaderboard = isLeaderboardPromo(item.kind);
  const sparksUpgrade = isSparksUpgradePromo(item.kind);

  const socialHref =
    item.kind === "communityTelegram"
      ? SUPPORT_URL
      : item.kind === "communityX"
        ? TWITTER_URL
        : null;
  const socialLogo =
    item.kind === "communityTelegram"
      ? "/telegram-logo.png"
      : item.kind === "communityX"
        ? "/x-logo.svg"
        : null;

  const modal = (
    <div className="promo-popup-backdrop" role="presentation">
      <div
        className={`promo-popup${
          community ? " promo-popup--community" : ""
        }${leaderboard ? " promo-popup--leaderboard" : ""}${
          sparksUpgrade ? " promo-popup--sparks" : ""
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={leaderboard ? undefined : "promo-popup-title"}
        aria-label={leaderboard ? "Daily XP Board" : undefined}
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

        {leaderboard ? (
          <ActivityLeaderboardPanel
            active={open}
            compact
            hideClose
            onGoHome={() => {
              onDismiss();
              if (typeof window !== "undefined") {
                window.location.assign("/");
              }
            }}
          />
        ) : community && socialLogo ? (
          <>
            <img
              src={socialLogo}
              alt=""
              className="promo-popup__social-logo promo-popup__social-logo--single"
              width={96}
              height={96}
            />
            <h2 id="promo-popup-title" className="promo-popup__title">
              {title}
            </h2>
            <p className="promo-popup__body">{body}</p>
          </>
        ) : sparksUpgrade ? (
          <>
            <span className="promo-popup__sparks-icon" aria-hidden>
              ⚡
            </span>
            <h2 id="promo-popup-title" className="promo-popup__title">
              {title}
            </h2>
            <p className="promo-popup__body">{body}</p>
          </>
        ) : (
          <>
            {resolvedImage ? (
              <img
                src={resolvedImage}
                alt=""
                className="promo-popup__art"
                width={160}
                height={160}
                onError={() =>
                  setImageIdx((i) =>
                    i + 1 < candidates.length ? i + 1 : i
                  )
                }
              />
            ) : (
              <div
                className="promo-popup__art promo-popup__art--placeholder"
                aria-hidden
              />
            )}
            <h2 id="promo-popup-title" className="promo-popup__title">
              {title}
            </h2>
            {item.kind === "newGame" && item.gameName ? (
              <p className="promo-popup__game">{item.gameName}</p>
            ) : null}
            <p className="promo-popup__body">{body}</p>
          </>
        )}

        {community && socialHref ? (
          <a
            className={`promo-popup__btn${
              item.kind === "communityTelegram"
                ? " promo-popup__btn--telegram"
                : " promo-popup__btn--x"
            }`}
            href={socialHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              playTouchSfx();
              onPrimary();
            }}
          >
            {cta}
          </a>
        ) : (
          <button
            type="button"
            className={`promo-popup__btn${
              leaderboard ? " promo-popup__btn--leaderboard" : ""
            }`}
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
