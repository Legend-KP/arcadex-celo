"use client";

import {
  DAILY_XP_REWARD_USDT,
  DAILY_XP_THRESHOLD,
} from "@/lib/daily-xp-board";

interface DailyXpHomeBannerProps {
  onOpenBoard?: () => void;
}

/**
 * Home promo strip — canvas ratio 1080×450 (12∶5).
 * Between winners strip and Continue playing.
 */
export default function DailyXpHomeBanner({
  onOpenBoard,
}: DailyXpHomeBannerProps) {
  const rewardLabel = `$${DAILY_XP_REWARD_USDT.toFixed(2)} USDT`;
  return (
    <section className="daily-xp-home-banner" aria-label="Earn Daily XP reward">
      <div className="daily-xp-home-banner__card">
        <div className="daily-xp-home-banner__copy">
          <p className="daily-xp-home-banner__eyebrow">Earn Daily</p>
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
            Reach {DAILY_XP_THRESHOLD} XP today
          </p>
        </div>
        <button
          type="button"
          className="daily-xp-home-banner__claim"
          onClick={onOpenBoard}
        >
          Claim Now
        </button>
      </div>
    </section>
  );
}
