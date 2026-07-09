import { fetchGameFromServer } from "@/lib/firestore-server";
import {
  fetchLeaderboardFromServer,
  fetchPersonalBestFromServer,
  fetchUserSubmittedScoreFromServer,
  fetchUserFromServer,
  saveGameProgressOnServer,
} from "@/lib/rtdb-server";
import {
  corsJsonResponse,
  handleCorsPreflightRequest,
} from "@/lib/cors";
import { gameHasLeaderboard, LEADERBOARD_MAX_ENTRIES, LeaderboardEntry } from "@/types";
import { isWalletAddress, tryNormalizeWalletAddress } from "@/lib/wallet-address";

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

function parseScoreBody(body: LeaderboardEntry & { value?: number }) {
  const score =
    typeof body.score === "number"
      ? body.score
      : typeof body.value === "number"
        ? body.value
        : undefined;
  return score;
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
    const personalBest =
      wallet
        ? await fetchPersonalBestFromServer(wallet, id)
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
      canSubmit:
        typeof personalBest === "number" &&
        typeof submittedBest === "number" &&
        personalBest > submittedBest,
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

    const body = (await request.json()) as LeaderboardEntry & {
      value?: number;
      playerName?: string;
    };
    const score = parseScoreBody(body);

    if (typeof score !== "number") {
      return corsJsonResponse(
        request,
        { error: "score is required." },
        { status: 400 }
      );
    }

    const wallet = tryNormalizeWalletAddress(body.walletAddress);
    let name = body.name?.trim() || body.playerName?.trim() || "";

    if (!name && wallet) {
      const profile = await fetchUserFromServer(wallet);
      name = profile?.name?.trim() || "";
    }

    if (!name && wallet) {
      name = `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
    }

    if (!name) {
      return corsJsonResponse(
        request,
        { error: "name is required when walletAddress is not provided." },
        { status: 400 }
      );
    }

    const entry = {
      name,
      score,
      walletAddress: body.walletAddress,
    };

    if (wallet && isWalletAddress(wallet)) {
      await saveGameProgressOnServer(wallet, id, score, true, {
        playerName: name,
      });
    } else {
      return corsJsonResponse(
        request,
        { error: "A wallet address is required to save scores." },
        { status: 400 }
      );
    }

    const personalBest = await fetchPersonalBestFromServer(wallet, id);
    const submittedBest = await fetchUserSubmittedScoreFromServer(id, {
      walletAddress: wallet,
      playerName: name,
    });

    return corsJsonResponse(request, {
      success: true,
      personalBest,
      submittedBest,
      canSubmit: personalBest > submittedBest,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to submit score.";
    return corsJsonResponse(request, { error: message }, { status: 500 });
  }
}
