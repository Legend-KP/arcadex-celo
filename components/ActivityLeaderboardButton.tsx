"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ActivityLeaderboardPanel from "@/components/ActivityLeaderboardPanel";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import { pingActivityVisit } from "@/lib/activity-client";
import { useClaimUiOverlay } from "@/lib/use-ui-overlay-gate";

function TrophyIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M8 4h8v2.5c0 2.2-1.8 4-4 4s-4-1.8-4-4V4Z"
        fill="#F5C542"
        stroke="#D4A017"
        strokeWidth="1.2"
      />
      <path
        d="M8 4H5.5A2.5 2.5 0 0 0 5.5 9c1.2 0 2.2-.7 2.7-1.7M16 4h2.5A2.5 2.5 0 0 1 18.5 9c-1.2 0-2.2-.7-2.7-1.7"
        stroke="#D4A017"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M10 14.5h4M12 10.5V14.5M9 19h6v1.5H9V19Z"
        stroke="#D4A017"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function ActivityLeaderboardButton({
  open: openControlled,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  const { walletAddress } = usePlayerProfile();
  const [openUncontrolled, setOpenUncontrolled] = useState(false);
  const controlled = typeof openControlled === "boolean";
  const open = controlled ? openControlled : openUncontrolled;
  const setOpen = (next: boolean) => {
    if (!controlled) setOpenUncontrolled(next);
    onOpenChange?.(next);
  };
  useClaimUiOverlay("activity-leaderboard", open);
  const [mounted, setMounted] = useState(false);
  const pingedRef = useRef(false);
  const closeOnBackdrop = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!walletAddress || pingedRef.current) return;
    pingedRef.current = true;
    void pingActivityVisit(walletAddress);
  }, [walletAddress]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const sheet =
    open && mounted
      ? createPortal(
          <div
            className="lb-backdrop activity-lb-backdrop"
            onPointerDown={(e) => {
              closeOnBackdrop.current = e.target === e.currentTarget;
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget && closeOnBackdrop.current) {
                setOpen(false);
              }
              closeOnBackdrop.current = false;
            }}
            role="presentation"
          >
            <div
              className="lb-sheet activity-lb-sheet"
              role="dialog"
              aria-modal="true"
              aria-label="XP Leaderboard"
              onClick={(e) => e.stopPropagation()}
            >
              <ActivityLeaderboardPanel
                active={open}
                onClose={() => setOpen(false)}
              />
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        type="button"
        className="activity-lb-btn"
        onClick={() => setOpen(true)}
        aria-label="Open weekly activity XP leaderboard"
      >
        <TrophyIcon />
        <span className="activity-lb-btn__label">XP</span>
      </button>
      {sheet}
    </>
  );
}
