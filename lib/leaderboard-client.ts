import { LeaderboardEntry } from "@/types";

export interface LeaderboardStatus {
  entries: LeaderboardEntry[];
  personalBest: number;
  submittedBest: number;
  canSubmit: boolean;
}

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

export async function getLeaderboardStatus(
  gameId: string,
  opts: { walletAddress?: string; playerName?: string }
): Promise<LeaderboardStatus> {
  const params = new URLSearchParams();
  if (opts.walletAddress) params.set("wallet", opts.walletAddress);
  if (opts.playerName) params.set("name", opts.playerName);
  const qs = params.toString();

  const res = await fetch(
    `/api/games/${gameId}/leaderboard${qs ? `?${qs}` : ""}`,
    { cache: "no-store" }
  );
  const data = (await res.json()) as {
    entries?: LeaderboardEntry[];
    personalBest?: number;
    submittedBest?: number;
    error?: string;
  };

  if (!res.ok) {
    throw new Error(data.error ?? "Could not load leaderboard.");
  }

  const personalBest = data.personalBest ?? 0;
  const submittedBest = data.submittedBest ?? 0;

  return {
    entries: data.entries ?? [],
    personalBest,
    submittedBest,
    canSubmit: personalBest > submittedBest,
  };
}

/** @deprecated Use getLeaderboardStatus for wallet-aware score state. */
export async function getUserBestScore(
  gameId: string,
  opts: { walletAddress?: string; playerName?: string }
): Promise<number> {
  const status = await getLeaderboardStatus(gameId, opts);
  return status.submittedBest;
}

export async function submitPaidScore(
  gameId: string,
  payload: { walletAddress: string; txHash: string; playerName?: string }
): Promise<{ submitted: boolean; score: number; submittedBest: number }> {
  const res = await fetch(`/api/games/${gameId}/leaderboard/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = (await res.json()) as {
    submitted?: boolean;
    score?: number;
    submittedBest?: number;
    error?: string;
    code?: string;
  };

  if (!res.ok) {
    throw new Error(data.error ?? "Could not submit score.");
  }

  return {
    submitted: data.submitted ?? true,
    score: data.score ?? 0,
    submittedBest: data.submittedBest ?? 0,
  };
}

/** Saves personal best only — does not post to the public leaderboard. */
export async function savePersonalBest(
  gameId: string,
  entry: LeaderboardEntry
): Promise<number> {
  const res = await fetch(`/api/games/${gameId}/progress`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      walletAddress: entry.walletAddress,
      value: entry.score,
      score: entry.score,
      ...(entry.name ? { playerName: entry.name } : {}),
    }),
  });

  const data = (await res.json()) as {
    progress?: { score?: number };
    error?: string;
  };

  if (!res.ok) {
    throw new Error(data.error ?? "Could not save score.");
  }

  return data.progress?.score ?? entry.score;
}
