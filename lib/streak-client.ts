"use client";

import {
  DEFAULT_STREAK_CAMPAIGN_ID,
} from "@/lib/arcadex-rewards";
import { checkInOnChain } from "@/lib/arcadex-rewards-check-in";
import { setWalletSessionToken, walletAuthHeaders } from "@/lib/wallet-session-client";
import type { SparkSnapshot, StoredSparkState } from "@/types";

export interface StreakStatus {
  configured: boolean;
  campaignId: number;
  currentDay: number;
  lastCheckInAt: number;
  milestoneReached: boolean;
  onChainClaimed: boolean;
  initialized?: boolean;
  canCheckIn: boolean;
  streakWouldReset: boolean;
  campaign: {
    active: boolean;
    cancelled?: boolean;
    requireEligibility?: boolean;
    requiredDays: number;
    minIntervalSeconds: number;
    maxClaims?: number;
    startTime?: number;
    endTime?: number;
    rewardMode: number;
    resetAfterMilestone: boolean;
  };
}

export async function fetchStreakStatus(
  walletAddress: string,
  campaignId: number = DEFAULT_STREAK_CAMPAIGN_ID
): Promise<StreakStatus> {
  const params = new URLSearchParams({
    walletAddress,
    campaignId: String(campaignId),
  });
  const res = await fetch(`/api/streak/status?${params}`, { cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as StreakStatus & {
    error?: string;
  };

  if (!res.ok) {
    throw new Error(data.error ?? "Could not load streak status.");
  }

  return data;
}

export interface StreakSyncResult {
  ok: boolean;
  walletAddress: string;
  day: number;
  campaignId: number;
  milestone: boolean;
  token: string;
  expiresIn: number;
  reward: {
    granted: boolean;
    sparks?: SparkSnapshot;
    state?: StoredSparkState;
  } | null;
}

export async function syncStreakCheckIn(opts: {
  walletAddress: string;
  txHash: string;
  campaignId?: number;
}): Promise<StreakSyncResult> {
  const res = await fetch("/api/streak/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      walletAddress: opts.walletAddress,
      txHash: opts.txHash,
      campaignId: opts.campaignId ?? DEFAULT_STREAK_CAMPAIGN_ID,
    }),
    cache: "no-store",
  });

  const data = (await res.json().catch(() => ({}))) as StreakSyncResult & {
    error?: string;
  };

  if (!res.ok || !data.token) {
    throw new Error(data.error ?? "Could not sync check-in.");
  }

  setWalletSessionToken(data.token);
  return data;
}

export class SessionRefreshError extends Error {
  constructor(
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = "SessionRefreshError";
  }
}

/**
 * Silent session mint from a recent on-chain daily check-in.
 * Prefer this over personal_sign when the user already checked in today.
 */
export async function refreshSessionFromCheckIn(
  walletAddress: string,
  campaignId: number = DEFAULT_STREAK_CAMPAIGN_ID
): Promise<string> {
  const res = await fetch("/api/streak/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress, campaignId }),
    cache: "no-store",
  });

  const data = (await res.json().catch(() => ({}))) as {
    token?: string;
    error?: string;
    code?: string;
  };

  if (!res.ok || !data.token) {
    throw new SessionRefreshError(
      data.error ?? "Could not restore your session from daily check-in.",
      data.code
    );
  }

  setWalletSessionToken(data.token);
  return data.token;
}

/**
 * Primary MiniPay sign-in: on-chain `checkIn` on ArcadeXRewards
 * (`0x0139e8CF3Cd43b0c0Cc8b4d75DAE6C6b3e41DE85`) + `/api/streak/sync` JWT.
 */
export async function performDailyCheckIn(
  walletAddress: string,
  campaignId: number = DEFAULT_STREAK_CAMPAIGN_ID
): Promise<StreakSyncResult> {
  const { txHash } = await checkInOnChain(campaignId);
  return syncStreakCheckIn({ walletAddress, txHash, campaignId });
}

/** Alias — daily streak check-in is the app's wallet sign-in. */
export const signInWithDailyCheckIn = performDailyCheckIn;

export async function grantStreakReward(opts: {
  walletAddress: string;
  txHash: string;
  campaignId?: number;
}) {
  const res = await fetch("/api/streak/grant-reward", {
    method: "POST",
    headers: walletAuthHeaders(),
    body: JSON.stringify({
      walletAddress: opts.walletAddress,
      txHash: opts.txHash,
      campaignId: opts.campaignId ?? DEFAULT_STREAK_CAMPAIGN_ID,
    }),
    cache: "no-store",
  });

  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    granted?: boolean;
    error?: string;
  };

  if (!res.ok) {
    throw new Error(data.error ?? "Could not grant streak reward.");
  }

  return data;
}
