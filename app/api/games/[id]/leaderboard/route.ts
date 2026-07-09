import { fetchGameFromServer } from "@/lib/firestore-server";
import {
  fetchLeaderboardFromServer,
  fetchPersonalBestFromServer,
  fetchUserSubmittedScoreFromServer,
} from "@/lib/rtdb-server";
import {
  corsJsonResponse,
  handleCorsPreflightRequest,
} from "@/lib/cors";
import { gameHasLeaderboard, LEADERBOARD_MAX_ENTRIES } from "@/types";
import { tryNormalizeWalletAddress } from "@/lib/wallet-address";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request) {
  return handleCorsPreflightRequest(request);
}

async function assertLeaderboardEnabled(
  request: Request,
  gameId: string
) {
  const game = await fetchGameFromServer(gameId);
  if (!game || !gameHasLeaderboard(game)) {
    return corsJsonResponse(
      request,
      { error: "Leaderboard is not enabled for this game." },
      { status: 404 }
    );
  }
  return null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const disabled = await assertLeaderboardEnabled(request, id);
    if (disabled) return disabled;

    const { searchParams } = new URL(request.url);
    const wallet = searchParams.get("wallet") ?? undefined;
    const name = searchParams.get("name") ?? undefined;

    const entries = await fetchLeaderboardFromServer(id, LEADERBOARD_MAX_ENTRIES);
    const walletNorm = tryNormalizeWalletAddress(wallet);
    const personalBest =
      walletNorm
        ? await fetchPersonalBestFromServer(walletNorm, id)
        : undefined;
    const submittedBest =
      wallet || name
        ? await fetchUserSubmittedScoreFromServer(id, {
            walletAddress: wallet,
            playerName: name,
          })
        : undefined;

    return corsJsonResponse(request, {
      entries,
      personalBest,
      submittedBest,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load leaderboard.";
    return corsJsonResponse(request, { error: message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const disabled = await assertLeaderboardEnabled(request, id);
    if (disabled) return disabled;

    return corsJsonResponse(
      request,
      {
        error:
          "Free score submission is disabled. Submit your score from the leaderboard after payment.",
        code: "PAYMENT_REQUIRED",
      },
      { status: 403 }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to submit score.";
    return corsJsonResponse(request, { error: message }, { status: 500 });
  }
}
