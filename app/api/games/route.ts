import { NextResponse } from "next/server";
import {
  apiErrorResponse,
  unauthorizedResponse,
  verifyAdminRequest,
} from "@/lib/admin-auth";
import {
  createGameOnServer,
  fetchGamesFromServer,
  isGameVisible,
} from "@/lib/firestore-server";
import { fetchAllGamePlayCounts } from "@/lib/rtdb-server";
import { Game } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const [games, playCounts] = await Promise.all([
      fetchGamesFromServer(),
      fetchAllGamePlayCounts().catch(
        () => ({}) as Record<string, number>
      ),
    ]);

    const visible = verifyAdminRequest(request)
      ? games
      : games.filter(isGameVisible);

    return NextResponse.json({ games: visible, playCounts });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load games.";
    const hint = message.includes("Cloud Firestore API")
      ? " Enable the Cloud Firestore API in Google Cloud Console, then redeploy."
      : "";
    return NextResponse.json(
      { error: `${message}${hint}` },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  if (!verifyAdminRequest(request)) return unauthorizedResponse();

  try {
    const body = (await request.json()) as Omit<Game, "id" | "createdAt">;

    if (!body.name?.trim() || !body.url?.trim()) {
      return NextResponse.json(
        { error: "Name and URL are required." },
        { status: 400 }
      );
    }

    const id = await createGameOnServer({
      name: body.name.trim(),
      thumbnail: body.thumbnail?.trim() ?? "",
      url: body.url.trim(),
      plays: body.plays?.trim() || "0",
      fallbackImage: body.fallbackImage?.trim() ?? "",
      active: body.active ?? true,
      live: body.live !== false,
      hasLeaderboard: body.hasLeaderboard !== false,
    });

    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err, "Failed to add game.");
  }
}
