import { NextResponse } from "next/server";
import { spendSparkOnServer, SparkSpendError } from "@/lib/player-backend";
import {
  isGameVisibleFromFlags,
  resolveGameGating,
} from "@/lib/game-gating";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { normalizeWalletAddress } from "@/lib/wallet-address";
import { requireWalletAuth } from "@/lib/wallet-session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`sparks-spend:ip:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }

  try {
    const body = (await request.json()) as {
      walletAddress?: string;
      gameId?: string;
    };
    const rawWallet = body.walletAddress?.trim() ?? "";
    const gameId = body.gameId?.trim() ?? "";

    if (!rawWallet) {
      return NextResponse.json(
        { error: "walletAddress is required.", code: "NO_WALLET" },
        { status: 400 }
      );
    }

    if (!gameId) {
      return NextResponse.json(
        { error: "gameId is required.", code: "NO_GAME" },
        { status: 400 }
      );
    }

    const wallet = normalizeWalletAddress(rawWallet);
    const auth = await requireWalletAuth(request, wallet);
    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.error, code: "UNAUTHORIZED" },
        { status: auth.status }
      );
    }

    // Per-wallet cap: Infinite Spark must not turn spend into an XP faucet.
    if (!(await checkRateLimit(`sparks-spend:wallet:${wallet}`, 20, 60_000))) {
      return rateLimitResponse();
    }

    const flags = await resolveGameGating(gameId);
    if (!flags || !isGameVisibleFromFlags(flags)) {
      return NextResponse.json(
        { error: "Game not found.", code: "GAME_NOT_FOUND" },
        { status: 404 }
      );
    }

    const result = await spendSparkOnServer(wallet);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SparkSpendError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code === "NO_SPARKS" ? 402 : 400 }
      );
    }

    const message =
      err instanceof Error ? err.message : "Failed to spend Spark.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
