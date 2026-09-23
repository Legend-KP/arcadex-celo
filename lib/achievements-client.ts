"use client";

import { getCachedWallet } from "@/lib/player-id";
import type { AchievementProgressItem } from "@/types";
import { levelFromXp } from "@/lib/achievements";

async function parseJson<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(
      (data as { error?: string }).error ?? `Request failed (${res.status}).`
    );
  }
  return data;
}

export async function fetchAchievements(walletAddress?: string): Promise<{
  xp: number;
  level: number;
  items: AchievementProgressItem[];
}> {
  const wallet = walletAddress ?? getCachedWallet() ?? "";
  if (!wallet) {
    return { xp: 0, level: levelFromXp(0), items: [] };
  }
  const res = await fetch(
    `/api/achievements?walletAddress=${encodeURIComponent(wallet)}`,
    { credentials: "include", cache: "no-store" }
  );
  return parseJson(res);
}

export async function claimAchievement(
  missionId: string,
  walletAddress?: string
): Promise<{
  xp: number;
  level: number;
  xpGranted: number;
  alreadyClaimed: boolean;
}> {
  const wallet = walletAddress ?? getCachedWallet() ?? "";
  if (!wallet) throw new Error("Connect a wallet to claim.");
  const res = await fetch("/api/achievements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ walletAddress: wallet, missionId }),
  });
  return parseJson(res);
}
