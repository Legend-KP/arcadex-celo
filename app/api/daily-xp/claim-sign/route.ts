import { NextResponse } from "next/server";
import { getAddress, type Address, type Hex } from "viem";
import {
  isArcadeXRewardsConfigured,
  REWARD_USDT,
} from "@/lib/arcadex-rewards";
import {
  readSpinNonce,
  readStreakProgress,
} from "@/lib/arcadex-rewards-verify";
import {
  computeDailyXp,
  DAILY_XP_CAMPAIGN_ID,
  DAILY_XP_REWARD_AMOUNT,
  DAILY_XP_REWARD_USDT,
  DAILY_XP_THRESHOLD,
  getUtcDayWindow,
  isDailyXpLive,
} from "@/lib/daily-xp-board";
import {
  fetchUserDailyXpFromServer,
  getDailyXpClaim,
  isDailyXpBanned,
  reserveDailyXpClaim,
  updateDailyXpClaimPending,
} from "@/lib/daily-xp-store";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import {
  getShufflePending,
  saveShufflePending,
  type ShufflePendingRecord,
} from "@/lib/player-backend";
import { signShuffleSpin } from "@/lib/shuffle-sign";
import { isWalletAddress, normalizeWalletAddress } from "@/lib/wallet-address";
import { requireWalletAuth } from "@/lib/wallet-session";

export const dynamic = "force-dynamic";

const SIGNATURE_TTL_SEC = 10 * 60;
const USDT_ADDRESS = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e" as Address;

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`daily-xp-claim-sign:${ip}`, 20, 60_000))) {
    return rateLimitResponse();
  }

  try {
    if (!isDailyXpLive()) {
      return NextResponse.json(
        { error: "Daily XP rewards are not live yet.", code: "NOT_LIVE" },
        { status: 403 }
      );
    }

    if (!isArcadeXRewardsConfigured()) {
      return NextResponse.json(
        { error: "Rewards contract not configured.", code: "NOT_CONFIGURED" },
        { status: 503 }
      );
    }

    const body = (await request.json()) as {
      walletAddress?: string;
      forceNew?: boolean;
    };

    const rawWallet = body.walletAddress?.trim() ?? "";
    if (!rawWallet || !isWalletAddress(rawWallet)) {
      return NextResponse.json(
        { error: "walletAddress is required.", code: "NO_WALLET" },
        { status: 400 }
      );
    }

    const wallet = normalizeWalletAddress(rawWallet);
    const auth = await requireWalletAuth(request, wallet);
    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.error, code: "UNAUTHORIZED" },
        { status: auth.status }
      );
    }

    if (!(await checkRateLimit(`daily-xp-claim-sign-wallet:${wallet}`, 8, 60_000))) {
      return rateLimitResponse();
    }

    if (await isDailyXpBanned(wallet)) {
      return NextResponse.json(
        { error: "This wallet is not eligible to claim.", code: "BANNED" },
        { status: 403 }
      );
    }

    const day = getUtcDayWindow();
    const existingClaim = await getDailyXpClaim(wallet, day.dayKey);
    if (existingClaim?.status === "claimed") {
      return NextResponse.json(
        { error: "Already claimed today's Daily XP reward.", code: "ALREADY_CLAIMED" },
        { status: 409 }
      );
    }

    const stats = await fetchUserDailyXpFromServer(wallet, day.dayKey);
    const xp = computeDailyXp(stats);
    if (!stats.checkedIn) {
      return NextResponse.json(
        {
          error: "Check in today before claiming.",
          code: "NO_CHECK_IN",
          xp,
          threshold: DAILY_XP_THRESHOLD,
        },
        { status: 403 }
      );
    }
    if (xp < DAILY_XP_THRESHOLD) {
      return NextResponse.json(
        {
          error: `Need ${DAILY_XP_THRESHOLD} XP today to claim.`,
          code: "BELOW_THRESHOLD",
          xp,
          threshold: DAILY_XP_THRESHOLD,
        },
        { status: 403 }
      );
    }

    const campaignId = DAILY_XP_CAMPAIGN_ID;
    const progress = await readStreakProgress(wallet, campaignId);
    if (!progress.campaign.active || progress.campaign.cancelled) {
      return NextResponse.json(
        { error: "Daily XP campaign is not active on-chain.", code: "INACTIVE" },
        { status: 400 }
      );
    }
    if (Number(progress.campaign.campaignType) !== 1) {
      return NextResponse.json(
        {
          error: "Daily XP campaign must be SHUFFLE type on-chain.",
          code: "WRONG_TYPE",
        },
        { status: 400 }
      );
    }
    if (!progress.canCheckIn) {
      return NextResponse.json(
        {
          error: "Already claimed on-chain for this UTC day.",
          code: "TOO_SOON",
        },
        { status: 409 }
      );
    }

    const nonceBig = await readSpinNonce(wallet, campaignId);
    const nonce = Number(nonceBig);
    const nowSec = Math.floor(Date.now() / 1000);

    const existingPending = await getShufflePending(wallet, campaignId, nonce);
    if (
      !body.forceNew &&
      existingPending &&
      !existingPending.consumedAt &&
      existingPending.deadline > nowSec + 30 &&
      existingPending.signature &&
      existingPending.rewardAmount === DAILY_XP_REWARD_AMOUNT.toString()
    ) {
      return NextResponse.json(formatClaimSignResponse(existingPending, xp));
    }

    const deadline = nowSec + SIGNATURE_TTL_SEC;
    const rewardMode = REWARD_USDT;
    const rewardTarget = getAddress(USDT_ADDRESS);
    const rewardAmount = DAILY_XP_REWARD_AMOUNT;

    const signature = await signShuffleSpin({
      player: getAddress(wallet) as Address,
      campaignId,
      rewardMode,
      rewardTarget,
      rewardAmount,
      nonce: nonceBig,
      deadline: BigInt(deadline),
    });

    const record: ShufflePendingRecord = {
      wallet,
      campaignId,
      nonce,
      outcomeId: "daily-xp-0.02",
      outcomeType: "usdt",
      displayAmount: DAILY_XP_REWARD_USDT,
      rewardMode,
      rewardTarget,
      rewardAmount: rewardAmount.toString(),
      deadline,
      signature: signature as string,
      createdAt: Date.now(),
    };

    await saveShufflePending(record);

    if (existingClaim?.status === "pending") {
      await updateDailyXpClaimPending({
        walletAddress: wallet,
        utcDay: day.dayKey,
        campaignId,
        nonce,
        rewardAmount: rewardAmount.toString(),
        signature: signature as string,
        deadline,
      });
    } else {
      await reserveDailyXpClaim({
        walletAddress: wallet,
        utcDay: day.dayKey,
        campaignId,
        nonce,
        rewardAmount: rewardAmount.toString(),
        signature: signature as string,
        deadline,
      });
    }

    return NextResponse.json(formatClaimSignResponse(record, xp));
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to prepare Daily XP claim.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function formatClaimSignResponse(record: ShufflePendingRecord, xp: number) {
  return {
    ok: true,
    campaignId: record.campaignId,
    nonce: record.nonce,
    deadline: record.deadline,
    signature: record.signature as Hex,
    rewardMode: record.rewardMode,
    rewardTarget: record.rewardTarget as Address,
    rewardAmount: record.rewardAmount,
    xp,
    threshold: DAILY_XP_THRESHOLD,
    rewardUsdt: DAILY_XP_REWARD_USDT,
  };
}
