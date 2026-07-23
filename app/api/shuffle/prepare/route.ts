import { NextResponse } from "next/server";
import { getAddress, type Address, type Hex } from "viem";
import { isArcadeXRewardsConfigured } from "@/lib/arcadex-rewards";
import {
  readSpinNonce,
  readStreakProgress,
} from "@/lib/arcadex-rewards-verify";
import { DEFAULT_SHUFFLE_CAMPAIGN_ID } from "@/lib/daily-play-mode";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import {
  getShufflePending,
  getShuffleUsdtCooldownUntil,
  saveShufflePending,
  type ShufflePendingRecord,
} from "@/lib/rtdb-server";
import {
  getShuffleTheaterCards,
  outcomeToOnChainReward,
  pickShuffleOutcome,
} from "@/lib/shuffle-outcomes";
import { signShuffleSpin } from "@/lib/shuffle-sign";
import { isWalletAddress, normalizeWalletAddress } from "@/lib/wallet-address";

export const dynamic = "force-dynamic";

const SIGNATURE_TTL_SEC = 10 * 60;

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`shuffle-prepare:${ip}`, 30, 60_000))) {
    return rateLimitResponse();
  }

  try {
    if (!isArcadeXRewardsConfigured()) {
      return NextResponse.json(
        { error: "Rewards contract not configured.", code: "NOT_CONFIGURED" },
        { status: 503 }
      );
    }

    const body = (await request.json()) as {
      walletAddress?: string;
      campaignId?: number;
    };

    const rawWallet = body.walletAddress?.trim() ?? "";
    const campaignId =
      typeof body.campaignId === "number" && Number.isFinite(body.campaignId)
        ? body.campaignId
        : DEFAULT_SHUFFLE_CAMPAIGN_ID;

    if (!rawWallet || !isWalletAddress(rawWallet)) {
      return NextResponse.json(
        { error: "walletAddress is required.", code: "NO_WALLET" },
        { status: 400 }
      );
    }

    const wallet = normalizeWalletAddress(rawWallet);
    if (!(await checkRateLimit(`shuffle-prepare-wallet:${wallet}`, 12, 60_000))) {
      return rateLimitResponse();
    }

    const progress = await readStreakProgress(wallet, campaignId);
    if (!progress.campaign.active || progress.campaign.cancelled) {
      return NextResponse.json(
        { error: "Shuffle campaign is not active.", code: "INACTIVE" },
        { status: 400 }
      );
    }
    if (Number(progress.campaign.campaignType) !== 1) {
      return NextResponse.json(
        {
          error: "Campaign is not a SHUFFLE campaign. Configure campaign 2 on-chain.",
          code: "WRONG_TYPE",
        },
        { status: 400 }
      );
    }
    if (!progress.canCheckIn) {
      return NextResponse.json(
        {
          error: "Already shuffled today. Come back after the daily interval.",
          code: "TOO_SOON",
        },
        { status: 409 }
      );
    }

    const nonceBig = await readSpinNonce(wallet, campaignId);
    const nonce = Number(nonceBig);

    const existing = await getShufflePending(wallet, campaignId, nonce);
    const nowSec = Math.floor(Date.now() / 1000);
    if (
      existing &&
      !existing.consumedAt &&
      existing.deadline > nowSec + 30 &&
      existing.signature
    ) {
      return NextResponse.json(formatPrepareResponse(existing));
    }

    const cooldownUntil = await getShuffleUsdtCooldownUntil(wallet);
    const usdtBlocked = cooldownUntil > Date.now();

    const outcome = pickShuffleOutcome({ usdtBlocked });
    const onChain = outcomeToOnChainReward(outcome);
    const deadline = BigInt(nowSec + SIGNATURE_TTL_SEC);
    const player = getAddress(wallet) as Address;

    const signature = await signShuffleSpin({
      player,
      campaignId,
      rewardMode: onChain.rewardMode,
      rewardTarget: onChain.rewardTarget,
      rewardAmount: onChain.rewardAmount,
      nonce: nonceBig,
      deadline,
    });

    const record: ShufflePendingRecord = {
      wallet,
      campaignId,
      nonce,
      outcomeId: outcome.id,
      outcomeType: outcome.type,
      displayAmount: outcome.amount,
      rewardMode: onChain.rewardMode,
      rewardTarget: onChain.rewardTarget,
      rewardAmount: onChain.rewardAmount.toString(),
      deadline: Number(deadline),
      signature,
      createdAt: Date.now(),
    };

    await saveShufflePending(record);

    return NextResponse.json(formatPrepareResponse(record));
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to prepare shuffle.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function formatPrepareResponse(record: ShufflePendingRecord) {
  return {
    ok: true,
    campaignId: record.campaignId,
    nonce: record.nonce,
    deadline: record.deadline,
    signature: record.signature as Hex,
    rewardMode: record.rewardMode,
    rewardTarget: record.rewardTarget,
    rewardAmount: record.rewardAmount,
    outcome: {
      id: record.outcomeId,
      type: record.outcomeType,
      amount: record.displayAmount,
    },
    theater: getShuffleTheaterCards(),
  };
}
