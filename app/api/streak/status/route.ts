import { NextResponse } from "next/server";
import {
  DEFAULT_STREAK_CAMPAIGN_ID,
  isArcadeXRewardsConfigured,
} from "@/lib/arcadex-rewards";
import { STREAK_PROGRESS_CACHE_MS, getStreakProgressCached } from "@/lib/streak-progress-cache";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { isWalletAddress, normalizeWalletAddress } from "@/lib/wallet-address";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`streak-status:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }

  try {
    if (!isArcadeXRewardsConfigured()) {
      return NextResponse.json(
        { error: "Streak rewards are not configured yet.", configured: false },
        { status: 503 }
      );
    }

    const { searchParams } = new URL(request.url);
    const rawWallet = searchParams.get("walletAddress")?.trim() ?? "";
    const campaignId = Number(
      searchParams.get("campaignId") ?? DEFAULT_STREAK_CAMPAIGN_ID
    );

    if (!rawWallet || !isWalletAddress(rawWallet)) {
      return NextResponse.json(
        { error: "A valid walletAddress is required." },
        { status: 400 }
      );
    }

    if (!Number.isFinite(campaignId) || campaignId < 1) {
      return NextResponse.json(
        { error: "Invalid campaignId." },
        { status: 400 }
      );
    }

    const wallet = normalizeWalletAddress(rawWallet);
    const status = await getStreakProgressCached(wallet, campaignId);
    const maxAgeSec = Math.floor(STREAK_PROGRESS_CACHE_MS / 1000);

    return NextResponse.json(
      { configured: true, ...status },
      {
        headers: {
          "Cache-Control": `private, max-age=${maxAgeSec}`,
        },
      }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load streak status.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
