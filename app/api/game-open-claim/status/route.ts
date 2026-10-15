import { NextResponse } from "next/server";
import { isGameOpenClaimEnabled } from "@/lib/feature-flags";
import { getGameOpenClaimStatus } from "@/lib/game-open-claim-server";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { isWalletAddress, normalizeWalletAddress } from "@/lib/wallet-address";

export const dynamic = "force-dynamic";

/**
 * Claim status is readable without a session (wallet is public on MiniPay).
 * The claim POST still requires wallet session auth.
 */
export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`game-open-claim-status:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }

  try {
    if (!isGameOpenClaimEnabled()) {
      return NextResponse.json(
        { error: "Game open claims are disabled.", code: "DISABLED" },
        { status: 503 }
      );
    }

    const { searchParams } = new URL(request.url);
    const rawWallet = searchParams.get("walletAddress")?.trim() ?? "";
    const gameId = searchParams.get("gameId")?.trim() ?? "";
    const gameName = searchParams.get("gameName")?.trim() ?? "";

    if (!rawWallet || !isWalletAddress(rawWallet)) {
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
    const status = await getGameOpenClaimStatus(wallet, gameId, gameName);
    return NextResponse.json({
      ok: true,
      ...status,
      canClaim: status.canClaim,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load claim status.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
