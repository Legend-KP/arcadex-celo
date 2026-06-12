import { GameProgress } from "@/types";

export interface GameProgressResponse {
  progress: GameProgress;
  hasLeaderboard: boolean;
}

export async function getGameProgress(
  gameId: string,
  walletAddress: string,
  playerName?: string
): Promise<GameProgressResponse> {
  const params = new URLSearchParams({ wallet: walletAddress });
  if (playerName?.trim()) {
    params.set("name", playerName.trim());
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
  value: number
): Promise<GameProgressResponse & { success: boolean }> {
  const res = await fetch(`/api/games/${gameId}/progress`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress, value }),
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
