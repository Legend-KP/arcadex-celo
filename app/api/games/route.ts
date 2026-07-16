import { NextResponse } from "next/server";
import {
  apiErrorResponse,
  unauthorizedResponse,
  verifyAdminRequest,
} from "@/lib/admin-auth";
import { recordApiMetric } from "@/lib/api-metrics";
import {
  GAMES_API_MAX_AGE_SEC,
  GAMES_API_STALE_WHILE_REVALIDATE_SEC,
} from "@/lib/game-cache";
import {
  createGameOnServer,
  fetchGamesFromServer,
  isGameVisible,
} from "@/lib/firestore-server";
import { fetchAllGamePlayCounts } from "@/lib/rtdb-server";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { Game } from "@/types";

export const dynamic = "force-dynamic";

const GAMES_LIST_IP_LIMIT = 120;
const GAMES_LIST_WINDOW_MS = 60_000;

export async function GET(request: Request) {
  const started = Date.now();
  const ip = getClientIp(request);

  if (!(await checkRateLimit(`games-list:ip:${ip}`, GAMES_LIST_IP_LIMIT, GAMES_LIST_WINDOW_MS))) {
    recordApiMetric({
      endpoint: "/api/games",
      method: "GET",
      status: 429,
      rateLimited: true,
      durationMs: Date.now() - started,
    });
    return rateLimitResponse();
  }

  try {
    const [games, playCounts] = await Promise.all([
      fetchGamesFromServer(),
      fetchAllGamePlayCounts().catch(
        () => ({}) as Record<string, number>
      ),
    ]);

    const isAdmin = await verifyAdminRequest(request);
    const visible = isAdmin
      ? games
      : games.filter(isGameVisible);

    recordApiMetric({
      endpoint: "/api/games",
      method: "GET",
      status: 200,
      durationMs: Date.now() - started,
      firestoreReads: 0,
      cacheHit: true,
      cacheLayer: "list",
    });

    return NextResponse.json(
      { games: visible, playCounts },
      {
        headers: {
          "Cache-Control": `public, max-age=${GAMES_API_MAX_AGE_SEC}, stale-while-revalidate=${GAMES_API_STALE_WHILE_REVALIDATE_SEC}`,
        },
      }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load games.";
    const hint = message.includes("Cloud Firestore API")
      ? " Enable the Cloud Firestore API in Google Cloud Console, then redeploy."
      : "";
    recordApiMetric({
      endpoint: "/api/games",
      method: "GET",
      status: 500,
      durationMs: Date.now() - started,
    });
    return NextResponse.json(
      { error: `${message}${hint}` },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  if (!(await verifyAdminRequest(request))) return unauthorizedResponse();

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
      contestLive: body.contestLive === true,
    });

    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err, "Failed to add game.");
  }
}
