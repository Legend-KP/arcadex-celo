"use client";

import { useEffect } from "react";

export interface LeaderboardSubmitToastState {
  success: boolean;
  message: string;
}

interface LeaderboardSubmitToastProps {
  toast: LeaderboardSubmitToastState | null;
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 5000;

export default function LeaderboardSubmitToast({
  toast,
  onDismiss,
}: LeaderboardSubmitToastProps) {
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [toast, onDismiss]);

  if (!toast) return null;

  return (
    <div
      className={`lb-submit-toast lb-submit-toast--${toast.success ? "success" : "error"}`}
      role="status"
      aria-live="polite"
    >
      <span className="lb-submit-toast__icon" aria-hidden="true">
        {toast.success ? "✓" : "!"}
      </span>
      <span className="lb-submit-toast__text">{toast.message}</span>
      <button
        type="button"
        className="lb-submit-toast__close"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
