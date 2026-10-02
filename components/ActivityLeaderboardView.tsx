"use client";

import DailyXpLiveBoard from "@/components/DailyXpLiveBoard";

/** Drawer Daily XP Board — main XP board UI. */
export default function ActivityLeaderboardView({
  onGoHome,
}: {
  onGoHome?: () => void;
} = {}) {
  return (
    <div className="activity-lb-view activity-lb-view--daily">
      <DailyXpLiveBoard onGoHome={onGoHome} />
    </div>
  );
}
