"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import ActivityLeaderboardPanel from "@/components/ActivityLeaderboardPanel";
import { formatContestCountdown } from "@/lib/contest";
import { SUPPORT_URL, TWITTER_URL } from "@/lib/app-footer-links";
import {
  getPromoBody,
  getPromoCtaLabel,
  getPromoTitle,
  isCommunityPromo,
  isContestPromo,
  isLeaderboardPromo,
  type PromoPopupCandidate,
} from "@/lib/promo-popups";
import { playTouchSfx } from "@/lib/sfx";

interface PromoPopupModalProps {
  open: boolean;
  item: PromoPopupCandidate | null;
  /** Square art candidates (logo → thumbnail → fallback); advances on load error. */
  imageCandidates?: string[];
  /** @deprecated Prefer imageCandidates */
  imageUrl?: string | null;
  /** Game accent hex for glassy timer / CTA (contest popups). */
  accentColor?: string | null;
  onDismiss: () => void;
  onPrimary: () => void;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const raw = hex.replace("#", "").trim();
  if (raw.length !== 3 && raw.length !== 6) return null;
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export default function PromoPopupModal({
  open,
  item,
  imageCandidates,
  imageUrl,
  accentColor,
  onDismiss,
  onPrimary,
}: PromoPopupModalProps) {
  const [mounted, setMounted] = useState(false);
  const [countdown, setCountdown] = useState("");
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

  useEffect(() => {
    if (!open || !item?.endsAt || isLeaderboardPromo(item.kind)) {
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
  const contest = isContestPromo(item.kind);
  const community = isCommunityPromo(item.kind);
  const leaderboard = isLeaderboardPromo(item.kind);
  const showTimer =
    (item.kind === "contestEnd" || item.kind === "contestStart") &&
    Boolean(item.endsAt);

  const rgb = accentColor ? hexToRgb(accentColor) : null;
  const themedStyle: CSSProperties | undefined =
    contest && rgb
      ? ({
          ["--promo-accent" as string]: accentColor,
          ["--promo-accent-rgb" as string]: `${rgb.r}, ${rgb.g}, ${rgb.b}`,
        } as CSSProperties)
      : undefined;

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
        className={`promo-popup${contest ? " promo-popup--contest" : ""}${
          community ? " promo-popup--community" : ""
        }${leaderboard ? " promo-popup--leaderboard" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={leaderboard ? undefined : "promo-popup-title"}
        aria-label={leaderboard ? "XP Leaderboard" : undefined}
        style={themedStyle}
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
          />
        ) : contest ? (
          <>
            <h2
              id="promo-popup-title"
              className="promo-popup__title promo-popup__title--contest"
            >
              {title}
            </h2>
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
            {item.gameName ? (
              <p className="promo-popup__game">{item.gameName}</p>
            ) : null}
            <p className="promo-popup__body">{body}</p>
            {showTimer && countdown ? (
              <p
                className="promo-popup__timer promo-popup__timer--glass"
                role="status"
              >
                <span className="promo-popup__timer-label">Time left</span>
                <span className="promo-popup__timer-value">{countdown}</span>
              </p>
            ) : null}
          </>
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
              contest ? " promo-popup__btn--glass" : ""
            }${leaderboard ? " promo-popup__btn--leaderboard" : ""}`}
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
