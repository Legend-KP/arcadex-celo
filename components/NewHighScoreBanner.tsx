"use client";

interface NewHighScoreBannerProps {
  visible: boolean;
  onOpenLeaderboard: () => void;
  onDismiss: () => void;
}

export default function NewHighScoreBanner({
  visible,
  onOpenLeaderboard,
  onDismiss,
}: NewHighScoreBannerProps) {
  if (!visible) return null;

  return (
    <div className="high-score-banner-wrap" role="presentation">
      <button
        type="button"
        className="high-score-banner"
        onClick={onOpenLeaderboard}
        aria-label="New high score — open leaderboard"
      >
        <span className="high-score-banner__icon" aria-hidden="true">
          🏆
        </span>
        <span className="high-score-banner__text">New High Score!</span>
        <span className="high-score-banner__chevron" aria-hidden="true">
          ›
        </span>
      </button>
      <button
        type="button"
        className="high-score-banner__dismiss"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
