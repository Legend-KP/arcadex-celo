import { LeaderboardEntry } from "@/types";

export async function getLeaderboard(
  gameId: string
): Promise<LeaderboardEntry[]> {
  const res = await fetch(`/api/games/${gameId}/leaderboard`, {
    cache: "no-store",
  });
  const data = (await res.json()) as { entries?: LeaderboardEntry[]; error?: string };

  if (!res.ok) {
    throw new Error(data.error ?? "Could not load leaderboard.");
  }

  return data.entries ?? [];
}

export async function getUserBestScore(
  gameId: string,
  opts: { walletAddress?: string; playerName?: string }
): Promise<number> {
  const params = new URLSearchParams();
  if (opts.walletAddress) params.set("wallet", opts.walletAddress);
  if (opts.playerName) params.set("name", opts.playerName);
  const qs = params.toString();

  const res = await fetch(
    `/api/games/${gameId}/leaderboard${qs ? `?${qs}` : ""}`,
    { cache: "no-store" }
  );
  const data = (await res.json()) as {
    personalBest?: number;
    error?: string;
  };

  if (!res.ok) {
    throw new Error(data.error ?? "Could not load personal best score.");
  }

  return data.personalBest ?? 0;
}

export async function submitScore(
  gameId: string,
  entry: LeaderboardEntry
): Promise<number> {
  const res = await fetch(`/api/games/${gameId}/leaderboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });

  const data = (await res.json()) as { personalBest?: number; error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? "Could not submit score.");
  }

  return data.personalBest ?? entry.score;
}
