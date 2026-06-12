import { fetchGameFromServer } from "@/lib/firestore-server";
import { corsOptionsResponse, jsonWithCors } from "@/lib/cors";
import {
  resolveGameProgressFromServer,
  saveGameProgressOnServer,
} from "@/lib/rtdb-server";
import { gameHasLeaderboard } from "@/types";
import { isWalletAddress } from "@/lib/wallet-address";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return corsOptionsResponse();
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const game = await fetchGameFromServer(id);
    if (!game) {
      return jsonWithCors({ error: "Game not found." }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const wallet = searchParams.get("wallet") ?? "";
    if (!isWalletAddress(wallet)) {
      return jsonWithCors(
        { error: "A valid wallet query parameter is required." },
        { status: 400 }
      );
    }

    const name = searchParams.get("name") ?? undefined;
    const hasLeaderboard = gameHasLeaderboard(game);
    const progress = await resolveGameProgressFromServer(
      wallet,
      id,
      hasLeaderboard,
      { playerName: name }
    );

    return jsonWithCors({ progress, hasLeaderboard });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load game progress.";
    return jsonWithCors({ error: message }, { status: 500 });
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
      return jsonWithCors({ error: "Game not found." }, { status: 404 });
    }

    const body = (await request.json()) as {
      walletAddress?: string;
      value?: number;
    };

    if (!body.walletAddress || !isWalletAddress(body.walletAddress)) {
      return jsonWithCors(
        { error: "walletAddress is required." },
        { status: 400 }
      );
    }

    if (typeof body.value !== "number") {
      return jsonWithCors({ error: "value is required." }, { status: 400 });
    }

    const hasLeaderboard = gameHasLeaderboard(game);
    const progress = await saveGameProgressOnServer(
      body.walletAddress,
      id,
      body.value,
      hasLeaderboard
    );

    return jsonWithCors({ success: true, progress, hasLeaderboard });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to save game progress.";
    return jsonWithCors({ error: message }, { status: 500 });
  }
}
