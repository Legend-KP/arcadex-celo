import { NextResponse } from "next/server";
import { loadDailyPlayConfig } from "@/lib/daily-play-config-server";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Runtime daily-play config — works with Cloudflare vars without rebuild. */
export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`daily-play-config:ip:${ip}`, 120, 60_000))) {
    return rateLimitResponse();
  }

  const config = await loadDailyPlayConfig();
  return NextResponse.json(
    {
      mode: config.mode,
      campaignId: config.campaignId,
      shuffle: config.shuffle,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
