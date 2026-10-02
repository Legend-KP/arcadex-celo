"use client";

import { useCallback, useState } from "react";
import DailyXpLiveBoard from "@/components/DailyXpLiveBoard";
import DailyXpTransition from "@/components/DailyXpTransition";
import { isDailyXpTransition } from "@/lib/daily-xp-board";

/** Drawer Daily XP Board — transition until Saturday 00:00 UTC, then live + Claim. */
export default function ActivityLeaderboardView() {
  const [live, setLive] = useState(() => !isDailyXpTransition());
  const handleGoLive = useCallback(() => setLive(true), []);

  if (!live) {
    return (
      <div className="activity-lb-view">
        <DailyXpTransition onGoLive={handleGoLive} />
      </div>
    );
  }

  return (
    <div className="activity-lb-view">
      <DailyXpLiveBoard />
    </div>
  );
}
