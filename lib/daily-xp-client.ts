"use client";

import type { Address, Hex } from "viem";
import {
  claimShuffleRewardOnChain,
  spinOnChain,
} from "@/lib/arcadex-rewards-spin";
import {
  DAILY_XP_CAMPAIGN_ID,
  DAILY_XP_THRESHOLD,
  type DailyXpLeaderboardEntry,
} from "@/lib/daily-xp-board";
import { walletAuthHeaders } from "@/lib/wallet-session-client";

export interface DailyXpBoardResponse {
  live: boolean;
  transition: boolean;
  dayKey: string | null;
  startsAt: number | null;
  endsAt: number | null;
  resetsIn: string | null;
  endsAtMs: number | null;
  threshold: number;
  entries: DailyXpLeaderboardEntry[];
  me: {
    rank: number | null;
    score: number;
    checkedIn: boolean;
    claimed: boolean;
    banned: boolean;
    canClaim: boolean;
    plays: number;
    spendUnits: number;
  } | null;
}

export interface DailyXpClaimSignResult {
  ok: boolean;
  campaignId: number;
  nonce: number;
  deadline: number;
  signature: Hex;
  rewardMode: number;
  rewardTarget: Address;
  rewardAmount: string;
  xp: number;
  threshold: number;
  rewardUsdt: number;
}

export async function getDailyXpLeaderboard(opts?: {
  walletAddress?: string;
}): Promise<DailyXpBoardResponse> {
  const params = new URLSearchParams();
  if (opts?.walletAddress) params.set("wallet", opts.walletAddress);
  const qs = params.toString();
  const res = await fetch(
    `/api/leaderboard/daily-xp${qs ? `?${qs}` : ""}`,
    { cache: "no-store" }
  );
  const data = (await res.json()) as DailyXpBoardResponse & { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? "Could not load Daily XP board.");
  }
  return {
    live: Boolean(data.live),
    transition: Boolean(data.transition),
    dayKey: data.dayKey ?? null,
    startsAt: data.startsAt ?? null,
    endsAt: data.endsAt ?? null,
    resetsIn: data.resetsIn ?? null,
    endsAtMs: data.endsAtMs ?? data.endsAt ?? null,
    threshold: data.threshold ?? DAILY_XP_THRESHOLD,
    entries: data.entries ?? [],
    me: data.me ?? null,
  };
}

export async function signDailyXpClaim(
  walletAddress: string,
  forceNew = false
): Promise<DailyXpClaimSignResult> {
  const res = await fetch("/api/daily-xp/claim-sign", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...walletAuthHeaders(),
    },
    body: JSON.stringify({ walletAddress, forceNew }),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as DailyXpClaimSignResult & {
    error?: string;
    code?: string;
  };
  if (!res.ok || !data.signature) {
    throw new Error(data.error ?? "Could not prepare Daily XP claim.");
  }
  return data;
}

export async function syncDailyXpClaim(opts: {
  walletAddress: string;
  txHash: string;
  campaignId: number;
  nonce: number;
}): Promise<{ ok: boolean; needsClaim: boolean }> {
  const res = await fetch("/api/daily-xp/claim-sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...walletAuthHeaders(),
    },
    body: JSON.stringify(opts),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    needsClaim?: boolean;
    error?: string;
  };
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? "Could not sync Daily XP claim.");
  }
  return { ok: true, needsClaim: Boolean(data.needsClaim) };
}

/**
 * Claim flow: server EIP-712 sign → on-chain spin → sync ledger → claim USDT.
 */
export async function performDailyXpClaim(walletAddress: string): Promise<{
  txHash: string;
  claimTxHash?: string;
}> {
  let prepare = await signDailyXpClaim(walletAddress);
  let txHash: string;
  try {
    ({ txHash } = await spinOnChain({
      campaignId: prepare.campaignId,
      rewardMode: prepare.rewardMode,
      rewardTarget: prepare.rewardTarget,
      rewardAmount: BigInt(prepare.rewardAmount),
      nonce: BigInt(prepare.nonce),
      deadline: BigInt(prepare.deadline),
      signature: prepare.signature,
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      !message.toLowerCase().includes("invalidspinsignature") &&
      !message.toLowerCase().includes("could not be verified")
    ) {
      throw err;
    }
    prepare = await signDailyXpClaim(walletAddress, true);
    ({ txHash } = await spinOnChain({
      campaignId: prepare.campaignId,
      rewardMode: prepare.rewardMode,
      rewardTarget: prepare.rewardTarget,
      rewardAmount: BigInt(prepare.rewardAmount),
      nonce: BigInt(prepare.nonce),
      deadline: BigInt(prepare.deadline),
      signature: prepare.signature,
    }));
  }

  const sync = await syncDailyXpClaim({
    walletAddress,
    txHash,
    campaignId: prepare.campaignId,
    nonce: prepare.nonce,
  });

  let claimTxHash: string | undefined;
  if (sync.needsClaim) {
    const claimed = await claimShuffleRewardOnChain(
      prepare.campaignId ?? DAILY_XP_CAMPAIGN_ID
    );
    claimTxHash = claimed.txHash;
  }

  return { txHash, claimTxHash };
}
