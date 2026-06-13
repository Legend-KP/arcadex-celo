import { fetchGameFromServer } from "@/lib/firestore-server";
import {
  resolveGameProgressFromServer,
  saveGameProgressOnServer,
} from "@/lib/rtdb-server";
import {
  corsJsonResponse,
  handleCorsPreflightRequest,
} from "@/lib/cors";
import { gameHasLeaderboard } from "@/types";
import { isWalletAddress } from "@/lib/wallet-address";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request) {
  return handleCorsPreflightRequest(request);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const game = await fetchGameFromServer(id);
    if (!game) {
      return corsJsonResponse(
        request,
        { error: "Game not found." },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(request.url);
    const wallet = searchParams.get("wallet") ?? "";
    const name = searchParams.get("name") ?? undefined;

    if (!isWalletAddress(wallet)) {
      return corsJsonResponse(
        request,
        { error: "A valid wallet query parameter is required." },
        { status: 400 }
      );
    }

    const hasLeaderboard = gameHasLeaderboard(game);
    const progress = await resolveGameProgressFromServer(
      wallet,
      id,
      hasLeaderboard,
      { playerName: name }
    );

    return corsJsonResponse(request, { progress, hasLeaderboard });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load game progress.";
    return corsJsonResponse(request, { error: message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const game = await fetchGameFromServer(id);
    if (!game) {
      return corsJsonResponse(
        request,
        { error: "Game not found." },
        { status: 404 }
      );
    }

    const body = (await request.json()) as {
      walletAddress?: string;
      value?: number;
      name?: string;
      playerName?: string;
    };

    if (!body.walletAddress || !isWalletAddress(body.walletAddress)) {
      return corsJsonResponse(
        request,
        { error: "walletAddress is required." },
        { status: 400 }
      );
    }

    if (typeof body.value !== "number") {
      return corsJsonResponse(
        request,
        { error: "value is required." },
        { status: 400 }
      );
    }

    const hasLeaderboard = gameHasLeaderboard(game);
    const progress = await saveGameProgressOnServer(
      body.walletAddress,
      id,
      body.value,
      hasLeaderboard,
      { playerName: body.playerName ?? body.name }
    );

    return corsJsonResponse(request, { success: true, progress, hasLeaderboard });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to save game progress.";
    return corsJsonResponse(request, { error: message }, { status: 500 });
  }
}
