"use client";

import { useEffect } from "react";

export type LeaderboardSubmitToastPhase = "submitting" | "success" | "error";

export interface LeaderboardSubmitToastState {
  phase: LeaderboardSubmitToastPhase;
  message: string;
}

interface LeaderboardSubmitToastProps {
  toast: LeaderboardSubmitToastState | null;
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 4500;

export default function LeaderboardSubmitToast({
  toast,
  onDismiss,
}: LeaderboardSubmitToastProps) {
  useEffect(() => {
    if (!toast || toast.phase === "submitting") return;
    const id = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [toast, onDismiss]);

  if (!toast) return null;

  return (
    <div
      className={`lb-submit-banner lb-submit-banner--${toast.phase}`}
      role="status"
      aria-live="polite"
    >
      <div className="lb-submit-banner__inner">
        <span className="lb-submit-banner__icon" aria-hidden="true">
          {toast.phase === "submitting" && (
            <span className="lb-submit-banner__spinner" />
          )}
          {toast.phase === "success" && "🏆"}
          {toast.phase === "error" && "!"}
        </span>
        <span className="lb-submit-banner__text">{toast.message}</span>
        {toast.phase !== "submitting" && (
          <button
            type="button"
            className="lb-submit-banner__close"
            onClick={onDismiss}
            aria-label="Dismiss"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
