"use client";

import type { Address, Hex } from "viem";
import {
  claimShuffleRewardOnChain,
  spinOnChain,
} from "@/lib/arcadex-rewards-spin";
import { GAME_OPEN_CLAIM_USDT } from "@/lib/game-open-claim";
import { walletAuthHeaders } from "@/lib/wallet-session-client";

export interface GameOpenClaimStatus {
  claimed: boolean;
  amountUsdt: number;
  campaignId: number | null;
  utcDay: string;
  payoutsEnabled: boolean;
  canClaim: boolean;
}

export interface GameOpenClaimSignResult {
  ok: boolean;
  gameId: string;
  campaignId: number;
  nonce: number;
  deadline: number;
  signature: Hex;
  rewardMode: number;
  rewardTarget: Address;
  rewardAmount: string;
  rewardUsdt: number;
}

export async function fetchGameOpenClaimStatus(
  walletAddress: string,
  gameId: string,
  gameName?: string
): Promise<GameOpenClaimStatus> {
  const params = new URLSearchParams({ walletAddress, gameId });
  if (gameName?.trim()) params.set("gameName", gameName.trim());
  const res = await fetch(`/api/game-open-claim/status?${params}`, {
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as GameOpenClaimStatus & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error ?? "Could not load claim status.");
  }
  return {
    claimed: Boolean(data.claimed),
    amountUsdt:
      typeof data.amountUsdt === "number"
        ? data.amountUsdt
        : GAME_OPEN_CLAIM_USDT,
    campaignId:
      typeof data.campaignId === "number" ? data.campaignId : null,
    utcDay: typeof data.utcDay === "string" ? data.utcDay : "",
    payoutsEnabled: Boolean(data.payoutsEnabled),
    canClaim: Boolean(data.canClaim ?? (data.payoutsEnabled && !data.claimed)),
  };
}

async function signGameOpenClaim(
  walletAddress: string,
  gameId: string,
  forceNew = false,
  gameName?: string
): Promise<GameOpenClaimSignResult> {
  const res = await fetch("/api/game-open-claim/claim-sign", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...walletAuthHeaders(),
    },
    body: JSON.stringify({ walletAddress, gameId, gameName, forceNew }),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as GameOpenClaimSignResult & {
    error?: string;
    code?: string;
  };
  if (!res.ok || !data.signature) {
    throw new Error(data.error ?? "Could not prepare game open claim.");
  }
  return data;
}

async function syncGameOpenClaim(opts: {
  walletAddress: string;
  gameId: string;
  txHash: string;
  campaignId: number;
  nonce: number;
}): Promise<{ ok: boolean; needsClaim: boolean }> {
  const res = await fetch("/api/game-open-claim/claim-sync", {
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
    throw new Error(data.error ?? "Could not sync game open claim.");
  }
  return { ok: true, needsClaim: Boolean(data.needsClaim) };
}

/**
 * Claim flow: server EIP-712 sign → on-chain spin → sync ledger → claim USDT.
 * Both spin and claim appear on ArcadeXRewards (Celoscan).
 */
export async function claimGameOpenReward(
  walletAddress: string,
  gameId: string,
  gameName?: string
): Promise<{
  claimed: boolean;
  amountUsdt: number;
  txHash: string;
  claimTxHash?: string;
}> {
  let prepare = await signGameOpenClaim(walletAddress, gameId, false, gameName);
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
    prepare = await signGameOpenClaim(walletAddress, gameId, true, gameName);
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

  const sync = await syncGameOpenClaim({
    walletAddress,
    gameId,
    txHash,
    campaignId: prepare.campaignId,
    nonce: prepare.nonce,
  });

  let claimTxHash: string | undefined;
  if (sync.needsClaim) {
    const claimed = await claimShuffleRewardOnChain(prepare.campaignId);
    claimTxHash = claimed.txHash;
  }

  return {
    claimed: true,
    amountUsdt: prepare.rewardUsdt ?? GAME_OPEN_CLAIM_USDT,
    txHash,
    claimTxHash,
  };
}
