import { NextResponse } from "next/server";
import {
  getDailyCampaignId,
  getDailyPlayMode,
} from "@/lib/daily-play-mode";

export const dynamic = "force-dynamic";

/** Runtime daily-play config — works with Cloudflare vars without rebuild. */
export async function GET() {
  const mode = getDailyPlayMode();
  return NextResponse.json(
    {
      mode,
      campaignId: getDailyCampaignId(),
      shuffle: mode === "shuffle",
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
