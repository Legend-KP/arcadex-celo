import { NextResponse } from "next/server";
import { incrementGamePlayCount } from "@/lib/rtdb-server";
import { fetchGameFromServer, isGameVisible } from "@/lib/firestore-server";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const game = await fetchGameFromServer(id);

    if (!game || !isGameVisible(game)) {
      return NextResponse.json({ error: "Game not found." }, { status: 404 });
    }

    const count = await incrementGamePlayCount(id);
    return NextResponse.json({ count });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to record play.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
