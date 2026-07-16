import { fetchGameFromServer } from "@/lib/firestore-server";
import {
  isGameVisibleFromFlags,
  resolveGameGating,
} from "@/lib/game-gating";
import {
  resolveGameProgressFromServer,
  saveGameProgressOnServer,
} from "@/lib/rtdb-server";
import {
  corsJsonResponse,
  handleCorsPreflightRequest,
} from "@/lib/cors";
import { recordApiMetric } from "@/lib/api-metrics";
import {
  getDebouncedProgressResponse,
  setDebouncedProgressResponse,
} from "@/lib/progress-response-cache";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { isWalletAddress, normalizeWalletAddress } from "@/lib/wallet-address";
import { requireWalletAuth } from "@/lib/wallet-session";

export const dynamic = "force-dynamic";

const PROGRESS_IP_LIMIT = 60;
const PROGRESS_WALLET_LIMIT = 30;
const PROGRESS_WINDOW_MS = 60_000;

export async function OPTIONS(request: Request) {
  return handleCorsPreflightRequest(request);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const started = Date.now();

  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const walletRaw = searchParams.get("wallet") ?? "";
    const name = searchParams.get("name") ?? undefined;

    if (!isWalletAddress(walletRaw)) {
      return corsJsonResponse(
        request,
        { error: "A valid wallet query parameter is required." },
        { status: 400 }
      );
    }

    const wallet = normalizeWalletAddress(walletRaw);
    const ip = getClientIp(request);

    const ipAllowed = checkRateLimit(
      `progress:ip:${ip}`,
      PROGRESS_IP_LIMIT,
      PROGRESS_WINDOW_MS
    );
    const walletAllowed = checkRateLimit(
      `progress:wallet:${wallet}:${id}`,
      PROGRESS_WALLET_LIMIT,
      PROGRESS_WINDOW_MS
    );

    if (!ipAllowed || !walletAllowed) {
      const debounced = getDebouncedProgressResponse(id, wallet);
      if (debounced) {
        recordApiMetric({
          endpoint: "/api/games/[id]/progress",
          method: "GET",
          status: 200,
          gameId: id,
          wallet,
          rateLimited: true,
          cacheHit: true,
          cacheLayer: "progress_debounce",
          durationMs: Date.now() - started,
          firestoreReads: 0,
        });
        return corsJsonResponse(request, debounced);
      }

      recordApiMetric({
        endpoint: "/api/games/[id]/progress",
        method: "GET",
        status: 429,
        gameId: id,
        wallet,
        rateLimited: true,
        durationMs: Date.now() - started,
      });
      return corsJsonResponse(
        request,
        { error: "Too many progress requests. Please slow down." },
        { status: 429 }
      );
    }

    const debounced = getDebouncedProgressResponse(id, wallet);
    if (debounced) {
      recordApiMetric({
        endpoint: "/api/games/[id]/progress",
        method: "GET",
        status: 200,
        gameId: id,
        wallet,
        cacheHit: true,
        cacheLayer: "progress_debounce",
        durationMs: Date.now() - started,
        firestoreReads: 0,
      });
      return corsJsonResponse(request, debounced);
    }

    const flags = await resolveGameGating(id);
    if (!flags || !isGameVisibleFromFlags(flags)) {
      return corsJsonResponse(
        request,
        { error: "Game not found." },
        { status: 404 }
      );
    }

    const hasLeaderboard = flags.hasLeaderboard !== false;
    const progress = await resolveGameProgressFromServer(
      wallet,
      id,
      hasLeaderboard,
      { playerName: name }
    );
    const highScore = progress.score ?? 0;

    const payload = {
      progress,
      hasLeaderboard,
      highScore,
      score: highScore,
    };

    setDebouncedProgressResponse(id, wallet, payload);

    recordApiMetric({
      endpoint: "/api/games/[id]/progress",
      method: "GET",
      status: 200,
      gameId: id,
      wallet,
      durationMs: Date.now() - started,
      firestoreReads: 0,
      cacheHit: false,
    });

    return corsJsonResponse(request, payload);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load game progress.";
    recordApiMetric({
      endpoint: "/api/games/[id]/progress",
      method: "GET",
      status: 500,
      durationMs: Date.now() - started,
    });
    return corsJsonResponse(request, { error: message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const started = Date.now();

  try {
    const { id } = await params;
    const flags = await resolveGameGating(id);
    if (!flags || !isGameVisibleFromFlags(flags)) {
      return corsJsonResponse(
        request,
        { error: "Game not found." },
        { status: 404 }
      );
    }

    const body = (await request.json()) as {
      walletAddress?: string;
      value?: number;
      score?: number;
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

    const auth = await requireWalletAuth(request, body.walletAddress);
    if (!auth.ok) {
      return corsJsonResponse(
        request,
        { error: auth.error },
        { status: auth.status }
      );
    }

    const scoreValue =
      typeof body.value === "number"
        ? body.value
        : typeof body.score === "number"
          ? body.score
          : undefined;

    if (typeof scoreValue !== "number") {
      return corsJsonResponse(
        request,
        { error: "value or score is required." },
        { status: 400 }
      );
    }

    const hasLeaderboard = flags.hasLeaderboard !== false;
    const progress = await saveGameProgressOnServer(
      body.walletAddress,
      id,
      scoreValue,
      hasLeaderboard,
      { playerName: body.playerName ?? body.name }
    );
    const highScore = progress.score ?? scoreValue;

    const payload = {
      success: true,
      progress,
      hasLeaderboard,
      highScore,
      score: highScore,
    };

    setDebouncedProgressResponse(
      id,
      normalizeWalletAddress(body.walletAddress),
      {
        progress,
        hasLeaderboard,
        highScore,
        score: highScore,
      }
    );

    recordApiMetric({
      endpoint: "/api/games/[id]/progress",
      method: "POST",
      status: 200,
      gameId: id,
      durationMs: Date.now() - started,
      firestoreReads: 0,
    });

    return corsJsonResponse(request, payload);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to save game progress.";
    recordApiMetric({
      endpoint: "/api/games/[id]/progress",
      method: "POST",
      status: 500,
      durationMs: Date.now() - started,
    });
    return corsJsonResponse(request, { error: message }, { status: 500 });
  }
}
