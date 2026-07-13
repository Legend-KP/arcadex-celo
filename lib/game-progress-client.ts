import { GameProgress } from "@/types";
import { walletAuthHeaders } from "@/lib/wallet-session-client";

export interface GameProgressResponse {
  progress: GameProgress;
  hasLeaderboard: boolean;
}

export async function getGameProgress(
  gameId: string,
  walletAddress: string,
  opts?: { playerName?: string }
): Promise<GameProgressResponse> {
  const params = new URLSearchParams({ wallet: walletAddress });
  if (opts?.playerName?.trim()) {
    params.set("name", opts.playerName.trim());
  }
  const res = await fetch(`/api/games/${gameId}/progress?${params}`, {
    cache: "no-store",
  });
  const data = (await res.json()) as GameProgressResponse & { error?: string };

  if (!res.ok) {
    throw new Error(data.error ?? "Could not load game progress.");
  }

  return {
    progress: data.progress ?? {},
    hasLeaderboard: data.hasLeaderboard ?? true,
  };
}

export async function saveGameProgress(
  gameId: string,
  walletAddress: string,
  value: number,
  opts?: { playerName?: string }
): Promise<GameProgressResponse & { success: boolean }> {
  const res = await fetch(`/api/games/${gameId}/progress`, {
    method: "POST",
    headers: walletAuthHeaders(),
    body: JSON.stringify({
      walletAddress,
      value,
      score: value,
      ...(opts?.playerName?.trim()
        ? { playerName: opts.playerName.trim() }
        : {}),
    }),
  });

  const data = (await res.json()) as GameProgressResponse & {
    success?: boolean;
    error?: string;
  };

  if (!res.ok) {
    throw new Error(data.error ?? "Could not save game progress.");
  }

  return {
    success: data.success ?? true,
    progress: data.progress ?? {},
    hasLeaderboard: data.hasLeaderboard ?? true,
  };
}
