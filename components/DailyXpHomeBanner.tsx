"use client";

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
  return (
    <section className="daily-xp-home-banner" aria-label="Earn Daily XP reward">
      <div className="daily-xp-home-banner__card">
        <div className="daily-xp-home-banner__copy">
          <p className="daily-xp-home-banner__eyebrow">Earn Daily</p>
          <p className="daily-xp-home-banner__amount">
            <span className="daily-xp-home-banner__amount-text">$0.02 USDT</span>
            <img
              className="daily-xp-home-banner__usdt"
              src="/tether-usdt-logo.png"
              alt=""
              width={40}
              height={40}
              decoding="async"
            />
          </p>
          <p className="daily-xp-home-banner__hint">Reach 100 XP today</p>
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
