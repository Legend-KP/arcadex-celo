import { NextResponse } from "next/server";
import { isGameOpenClaimEnabled } from "@/lib/feature-flags";
import { gameOpenClaimDayKey } from "@/lib/game-open-claim";
import { isGameOpenClaimDayOpen } from "@/lib/game-open-claim-server";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Whether new game-open claims are still open for the current UTC day. */
export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`game-open-claim-day:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }

  try {
    if (!isGameOpenClaimEnabled()) {
      return NextResponse.json(
        { error: "Game open claims are disabled.", code: "DISABLED" },
        { status: 503 }
      );
    }

    const claimsOpen = await isGameOpenClaimDayOpen();
    return NextResponse.json({
      ok: true,
      claimsOpen,
      utcDay: gameOpenClaimDayKey(),
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load claim day.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
