import { NextResponse } from "next/server";
import {
  claimAchievementOnD1,
  getAchievementsForWallet,
} from "@/lib/d1-achievements";
import { levelFromXp } from "@/lib/achievements";
import { recordApiMetric } from "@/lib/api-metrics";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import {
  isWalletAddress,
  normalizeWalletAddress,
} from "@/lib/wallet-address";
import { requireWalletAuth } from "@/lib/wallet-session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const started = Date.now();
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`achievements:ip:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }

  try {
    const { searchParams } = new URL(request.url);
    const walletRaw = searchParams.get("walletAddress")?.trim() ?? "";
    if (!walletRaw || !isWalletAddress(walletRaw)) {
      return NextResponse.json(
        { error: "walletAddress is required." },
        { status: 400 }
      );
    }
    const wallet = normalizeWalletAddress(walletRaw);
    const auth = await requireWalletAuth(request, wallet);
    if (!auth.ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const data = await getAchievementsForWallet(wallet);
    recordApiMetric({
      endpoint: "/api/achievements",
      method: "GET",
      status: 200,
      durationMs: Date.now() - started,
    });
    return NextResponse.json({
      xp: data.xp,
      level: levelFromXp(data.xp),
      items: data.items,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load achievements.";
    recordApiMetric({
      endpoint: "/api/achievements",
      method: "GET",
      status: 500,
      durationMs: Date.now() - started,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const started = Date.now();
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`achievements-claim:ip:${ip}`, 30, 60_000))) {
    return rateLimitResponse();
  }

  try {
    const body = (await request.json()) as {
      walletAddress?: string;
      missionId?: string;
    };
    const walletRaw = body.walletAddress?.trim() ?? "";
    const missionId = body.missionId?.trim() ?? "";
    if (!walletRaw || !isWalletAddress(walletRaw)) {
      return NextResponse.json(
        { error: "walletAddress is required." },
        { status: 400 }
      );
    }
    if (!missionId) {
      return NextResponse.json(
        { error: "missionId is required." },
        { status: 400 }
      );
    }

    const wallet = normalizeWalletAddress(walletRaw);
    const auth = await requireWalletAuth(request, wallet);
    if (!auth.ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await claimAchievementOnD1(wallet, missionId);
    recordApiMetric({
      endpoint: "/api/achievements",
      method: "POST",
      status: 200,
      durationMs: Date.now() - started,
    });
    return NextResponse.json({
      ...result,
      level: levelFromXp(result.xp),
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to claim achievement.";
    const status = message.includes("Progress not met") ? 400 : 500;
    recordApiMetric({
      endpoint: "/api/achievements",
      method: "POST",
      status,
      durationMs: Date.now() - started,
    });
    return NextResponse.json({ error: message }, { status });
  }
}
