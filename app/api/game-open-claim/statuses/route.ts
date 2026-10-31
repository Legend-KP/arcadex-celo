import { NextResponse } from "next/server";
import { isGameOpenClaimEnabled } from "@/lib/feature-flags";
import { listGameOpenClaimStatuses } from "@/lib/game-open-claim-server";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { isWalletAddress } from "@/lib/wallet-address";

export const dynamic = "force-dynamic";

/**
 * Home claim badges for every live game in one invocation.
 * Replaces N calls to /api/game-open-claim/status.
 */
export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`game-open-claim-statuses:${ip}`, 30, 60_000))) {
    return rateLimitResponse();
  }

  try {
    if (!isGameOpenClaimEnabled()) {
      return NextResponse.json(
        { error: "Game open claims are disabled.", code: "DISABLED" },
        { status: 503 }
      );
    }

    const body = (await request.json()) as {
      walletAddress?: string;
      games?: { id?: string; name?: string }[];
    };
    const rawWallet = body.walletAddress?.trim() ?? "";
    if (!rawWallet || !isWalletAddress(rawWallet)) {
      return NextResponse.json(
        { error: "walletAddress is required.", code: "NO_WALLET" },
        { status: 400 }
      );
    }
    if (!Array.isArray(body.games)) {
      return NextResponse.json(
        { error: "games is required.", code: "NO_GAMES" },
        { status: 400 }
      );
    }

    const games = body.games.flatMap((game) => {
      const id = game?.id?.trim() ?? "";
      if (!id) return [];
      return [{ id, name: game?.name?.trim() ?? "" }];
    });

    const batch = await listGameOpenClaimStatuses(rawWallet, games);
    return NextResponse.json({ ok: true, ...batch });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load claim status.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
