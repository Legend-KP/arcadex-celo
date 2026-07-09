"use client";

interface SubmitScorePopupProps {
  open: boolean;
  score: number;
  submitting?: boolean;
  error?: string;
  contestLive?: boolean;
  onSubmit: () => void;
  onDismiss: () => void;
}

export default function SubmitScorePopup({
  open,
  score,
  submitting = false,
  error = "",
  contestLive = false,
  onSubmit,
  onDismiss,
}: SubmitScorePopupProps) {
  if (!open) return null;

  return (
    <div className="submit-score-backdrop" role="presentation">
      <div
        className="submit-score-popup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="submit-score-title"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="submit-score-popup__icon" aria-hidden="true">
          🏆
        </span>
        <h2 id="submit-score-title" className="submit-score-popup__title">
          New High Score!
        </h2>
        <p className="submit-score-popup__score">{score.toLocaleString()}</p>
        <p className="submit-score-popup__body">
          Submit your score to save it
          {contestLive ? " and enter the live contest" : ""}.
        </p>
        {error && (
          <p className="submit-score-popup__error" role="alert">
            {error}
          </p>
        )}
        <div className="submit-score-popup__actions">
          <button
            type="button"
            className="submit-score-popup__btn submit-score-popup__btn--primary"
            onClick={onSubmit}
            disabled={submitting}
          >
            {submitting ? "Submitting…" : "Submit Score"}
          </button>
          <button
            type="button"
            className="submit-score-popup__btn submit-score-popup__btn--secondary"
            onClick={onDismiss}
            disabled={submitting}
          >
            Not Now
          </button>
        </div>
      </div>
    </div>
  );
}
