"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ONBOARDING_SLIDES } from "@/lib/onboarding";

interface OnboardingModalProps {
  open: boolean;
  onComplete: () => void;
}

export default function OnboardingModal({
  open,
  onComplete,
}: OnboardingModalProps) {
  const [slideIndex, setSlideIndex] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setSlideIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!open || !mounted) return null;

  const isLast = slideIndex >= ONBOARDING_SLIDES.length - 1;
  const src = ONBOARDING_SLIDES[slideIndex];

  function handlePrimary() {
    if (isLast) {
      onComplete();
      return;
    }
    setSlideIndex((prev) => prev + 1);
  }

  const modal = (
    <div className="game-tutorial-backdrop" role="presentation">
      <div
        className="game-tutorial"
        role="dialog"
        aria-modal="true"
        aria-label={`ArcadeX tutorial, step ${slideIndex + 1} of ${ONBOARDING_SLIDES.length}`}
      >
        <div className="game-tutorial-media">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={src}
            src={src}
            alt={`ArcadeX tutorial step ${slideIndex + 1}`}
            className="game-tutorial-img"
            loading="eager"
            fetchPriority="high"
            decoding="async"
          />
        </div>
        <button
          type="button"
          className="game-tutorial-btn"
          onClick={handlePrimary}
        >
          {isLast ? "Let's Go" : "Next"}
        </button>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
