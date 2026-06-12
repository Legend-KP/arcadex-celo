import { NextResponse } from "next/server";
import { fetchGameFromServer } from "@/lib/firestore-server";
import {
  fetchLeaderboardFromServer,
  fetchUserBestScoreFromServer,
  submitLeaderboardEntryOnServer,
} from "@/lib/rtdb-server";
import { gameHasLeaderboard, LEADERBOARD_MAX_ENTRIES, LeaderboardEntry } from "@/types";

export const dynamic = "force-dynamic";

async function assertLeaderboardEnabled(gameId: string) {
  const game = await fetchGameFromServer(gameId);
  if (!game || !gameHasLeaderboard(game)) {
    return NextResponse.json(
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
    const disabled = await assertLeaderboardEnabled(id);
    if (disabled) return disabled;

    const { searchParams } = new URL(request.url);
    const wallet = searchParams.get("wallet") ?? undefined;
    const name = searchParams.get("name") ?? undefined;

    const entries = await fetchLeaderboardFromServer(id, LEADERBOARD_MAX_ENTRIES);
    const personalBest =
      wallet || name
        ? await fetchUserBestScoreFromServer(id, {
            walletAddress: wallet,
            playerName: name,
          })
        : undefined;

    return NextResponse.json({ entries, personalBest });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load leaderboard.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const disabled = await assertLeaderboardEnabled(id);
    if (disabled) return disabled;

    const body = (await request.json()) as LeaderboardEntry;

    if (!body.name?.trim() || typeof body.score !== "number") {
      return NextResponse.json(
        { error: "name and score are required." },
        { status: 400 }
      );
    }

    const entry = {
      name: body.name.trim(),
      score: body.score,
      walletAddress: body.walletAddress,
    };

    await submitLeaderboardEntryOnServer(id, entry);

    const personalBest = await fetchUserBestScoreFromServer(id, {
      walletAddress: entry.walletAddress,
      playerName: entry.name,
    });

    return NextResponse.json({ success: true, personalBest });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to submit score.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
