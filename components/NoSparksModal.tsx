"use client";

import { createPortal } from "react-dom";

interface NoSparksModalProps {
  open: boolean;
  onClose: () => void;
  onGetSpark: () => void;
}

export default function NoSparksModal({
  open,
  onClose,
  onGetSpark,
}: NoSparksModalProps) {
  if (!open) return null;

  const modal = (
    <div className="no-sparks-backdrop" onClick={onClose} role="presentation">
      <div
        className="no-sparks-popup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="no-sparks-title"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="no-sparks-popup__icon" aria-hidden>
          ⚡
        </span>
        <h2 id="no-sparks-title" className="no-sparks-popup__title">
          No sparks left
        </h2>
        <button
          type="button"
          className="no-sparks-popup__btn"
          onClick={onGetSpark}
        >
          Get Spark
        </button>
      </div>
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(modal, document.body)
    : modal;
}
