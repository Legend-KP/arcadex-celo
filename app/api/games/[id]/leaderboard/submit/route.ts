import { fetchGameFromServer } from "@/lib/firestore-server";
import {
  activateScoreSubmitOnServer,
  ScoreSubmitActivationError,
} from "@/lib/rtdb-server";
import {
  corsJsonResponse,
  handleCorsPreflightRequest,
} from "@/lib/cors";
import { gameHasLeaderboard } from "@/types";
import { isWalletAddress, normalizeWalletAddress } from "@/lib/wallet-address";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request) {
  return handleCorsPreflightRequest(request);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const game = await fetchGameFromServer(id);
    if (!game || !gameHasLeaderboard(game)) {
      return corsJsonResponse(
        request,
        { error: "Leaderboard is not enabled for this game." },
        { status: 404 }
      );
    }

    const body = (await request.json()) as {
      walletAddress?: string;
      txHash?: string;
      score?: number;
    };

    const rawWallet = body.walletAddress?.trim() ?? "";
    const txHash = body.txHash?.trim() ?? "";
    const score = body.score;

    if (!rawWallet || !isWalletAddress(rawWallet)) {
      return corsJsonResponse(
        request,
        { error: "walletAddress is required.", code: "NO_WALLET" },
        { status: 400 }
      );
    }

    if (!txHash) {
      return corsJsonResponse(
        request,
        { error: "txHash is required.", code: "INVALID_TX" },
        { status: 400 }
      );
    }

    if (typeof score !== "number" || !Number.isFinite(score) || score <= 0) {
      return corsJsonResponse(
        request,
        { error: "score is required.", code: "NO_SCORE" },
        { status: 400 }
      );
    }

    const wallet = normalizeWalletAddress(rawWallet);
    const result = await activateScoreSubmitOnServer(wallet, id, txHash, score);

    return corsJsonResponse(request, {
      success: true,
      ...result,
    });
  } catch (err) {
    if (err instanceof ScoreSubmitActivationError) {
      const status = err.code === "TX_ALREADY_USED" ? 409 : 400;
      return corsJsonResponse(
        request,
        { error: err.message, code: err.code },
        { status }
      );
    }

    const message =
      err instanceof Error ? err.message : "Failed to submit score.";
    return corsJsonResponse(request, { error: message }, { status: 500 });
  }
}
