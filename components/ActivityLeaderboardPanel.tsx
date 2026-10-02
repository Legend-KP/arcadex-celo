"use client";

import DailyXpLiveBoard from "@/components/DailyXpLiveBoard";

interface ActivityLeaderboardPanelProps {
  active: boolean;
  compact?: boolean;
  hideClose?: boolean;
  onClose?: () => void;
  onGoHome?: () => void;
}

/** Sheet / promo Daily XP Board body. */
export default function ActivityLeaderboardPanel({
  active,
  compact = false,
  hideClose = false,
  onClose,
  onGoHome,
}: ActivityLeaderboardPanelProps) {
  if (!active) return null;

  return (
    <div
      className={`activity-lb-panel${compact ? " activity-lb-panel--compact" : ""}`}
    >
      <DailyXpLiveBoard
        compact={compact}
        hideClose={hideClose}
        onClose={onClose}
        onGoHome={onGoHome}
      />
    </div>
  );
}
