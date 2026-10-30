"use client";

import { formatGameOpenUsdt, GAME_OPEN_CLAIM_BANNER_USDT } from "@/lib/game-open-claim";

interface EarnNowHomeBannerProps {
  onOpen?: () => void;
}

/** Home promo strip — replaces Daily XP banner (code kept, UI gated). */
export default function EarnNowHomeBanner({ onOpen }: EarnNowHomeBannerProps) {
  const rewardLabel = `$${formatGameOpenUsdt(GAME_OPEN_CLAIM_BANNER_USDT)} USDT`;
  return (
    <section className="daily-xp-home-banner" aria-label="Earn everyday reward">
      <div className="daily-xp-home-banner__card">
        <div className="daily-xp-home-banner__copy">
          <p className="daily-xp-home-banner__eyebrow">Earn Everyday</p>
          <p className="daily-xp-home-banner__amount">
            <span className="daily-xp-home-banner__amount-text">
              {rewardLabel}
            </span>
            <img
              className="daily-xp-home-banner__usdt"
              src="/tether-usdt-logo.png"
              alt=""
              width={40}
              height={40}
              decoding="async"
            />
          </p>
          <p className="daily-xp-home-banner__hint">
            Open any live game to claim
          </p>
        </div>
        <button
          type="button"
          className="daily-xp-home-banner__claim"
          onClick={onOpen}
        >
          Claim Now
        </button>
      </div>
    </section>
  );
}
