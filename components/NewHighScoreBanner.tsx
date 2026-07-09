"use client";

interface NewHighScoreBannerProps {
  score: number;
  onTap: () => void;
  onDismiss: () => void;
}

export default function NewHighScoreBanner({
  score,
  onTap,
  onDismiss,
}: NewHighScoreBannerProps) {
  return (
    <div className="high-score-banner-wrap">
      <button
        type="button"
        className="high-score-banner"
        onClick={onTap}
        aria-label={`New high score ${score.toLocaleString()}. Tap to open leaderboard.`}
      >
        <span className="high-score-banner__icon" aria-hidden="true">🏆</span>
        <span className="high-score-banner__text">
          <strong>New High Score!</strong>
          <span className="high-score-banner__score">{score.toLocaleString()}</span>
        </span>
        <span className="high-score-banner__cta">View →</span>
      </button>
      <button
        type="button"
        className="high-score-banner__dismiss"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
