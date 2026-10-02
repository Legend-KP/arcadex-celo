"use client";

import { useCallback, useState } from "react";
import DailyXpLiveBoard from "@/components/DailyXpLiveBoard";
import DailyXpTransition from "@/components/DailyXpTransition";
import { isDailyXpTransition } from "@/lib/daily-xp-board";

interface ActivityLeaderboardPanelProps {
  active: boolean;
  compact?: boolean;
  hideClose?: boolean;
  onClose?: () => void;
}

/** Sheet / promo Daily XP Board body. */
export default function ActivityLeaderboardPanel({
  active,
  compact = false,
  hideClose = false,
  onClose,
}: ActivityLeaderboardPanelProps) {
  const [live, setLive] = useState(() => !isDailyXpTransition());
  const handleGoLive = useCallback(() => setLive(true), []);

  if (!active) return null;

  if (!live) {
    return (
      <div
        className={`activity-lb-panel${compact ? " activity-lb-panel--compact" : ""}`}
      >
        <DailyXpTransition
          compact={compact}
          hideClose={hideClose}
          onClose={onClose}
          onGoLive={handleGoLive}
        />
      </div>
    );
  }

  return (
    <div
      className={`activity-lb-panel${compact ? " activity-lb-panel--compact" : ""}`}
    >
      <DailyXpLiveBoard
        compact={compact}
        hideClose={hideClose}
        onClose={onClose}
      />
    </div>
  );
}
