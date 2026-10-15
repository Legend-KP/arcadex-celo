import { NextResponse } from "next/server";
import { getAddress, type Address, type Hex } from "viem";
import {
  CAMPAIGN_TYPE_SHUFFLE,
  isArcadeXRewardsConfigured,
  REWARD_USDT,
} from "@/lib/arcadex-rewards";
import {
  readSpinNonce,
  readStreakProgress,
} from "@/lib/arcadex-rewards-verify";
import { isGameOpenClaimEnabled } from "@/lib/feature-flags";
import {
  GAME_OPEN_CLAIM_REWARD_AMOUNT,
  GAME_OPEN_CLAIM_USDT,
} from "@/lib/game-open-claim";
import {
  assertLiveGame,
  GameOpenClaimError,
  getGameOpenClaimStatus,
  requireGameOpenCampaign,
  reserveGameOpenClaim,
} from "@/lib/game-open-claim-server";
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
  if (!(await checkRateLimit(`game-open-claim-sign:${ip}`, 20, 60_000))) {
    return rateLimitResponse();
  }

  try {
    if (!isGameOpenClaimEnabled()) {
      return NextResponse.json(
        { error: "Game open claims are disabled.", code: "DISABLED" },
        { status: 503 }
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
      gameId?: string;
      gameName?: string;
      forceNew?: boolean;
    };

    const rawWallet = body.walletAddress?.trim() ?? "";
    const gameId = body.gameId?.trim() ?? "";
    const gameName = body.gameName?.trim() ?? "";

    if (!rawWallet || !isWalletAddress(rawWallet)) {
      return NextResponse.json(
        { error: "walletAddress is required.", code: "NO_WALLET" },
        { status: 400 }
      );
    }
    if (!gameId) {
      return NextResponse.json(
        { error: "gameId is required.", code: "NO_GAME" },
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

    if (!(await checkRateLimit(`game-open-claim-sign-wallet:${wallet}`, 8, 60_000))) {
      return rateLimitResponse();
    }

    await assertLiveGame(gameId);
    const campaignId = await requireGameOpenCampaign(gameId, gameName);

    const status = await getGameOpenClaimStatus(wallet, gameId, gameName);
    if (status.claimed) {
      return NextResponse.json(
        { error: "Already claimed today's open reward for this game.", code: "ALREADY_CLAIMED" },
        { status: 409 }
      );
    }

    const progress = await readStreakProgress(wallet, campaignId);
    if (!progress.campaign.active || progress.campaign.cancelled) {
      return NextResponse.json(
        { error: "Game open campaign is not active on-chain.", code: "INACTIVE" },
        { status: 400 }
      );
    }
    if (Number(progress.campaign.campaignType) !== CAMPAIGN_TYPE_SHUFFLE) {
      return NextResponse.json(
        { error: "Game open campaign must be SHUFFLE type.", code: "WRONG_TYPE" },
        { status: 400 }
      );
    }
    if (!progress.canCheckIn) {
      return NextResponse.json(
        { error: "Already claimed on-chain for this game today.", code: "TOO_SOON" },
        { status: 409 }
      );
    }

    const maxPayout = BigInt(progress.campaign.maxSinglePayout || "0");
    if (maxPayout > BigInt(0) && GAME_OPEN_CLAIM_REWARD_AMOUNT > maxPayout) {
      return NextResponse.json(
        { error: "Campaign maxSinglePayout is too low for 0.005 USDT.", code: "BAD_PAYOUT" },
        { status: 400 }
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
      existingPending.rewardAmount === GAME_OPEN_CLAIM_REWARD_AMOUNT.toString()
    ) {
      return NextResponse.json(formatSignResponse(existingPending, gameId));
    }

    const deadline = nowSec + SIGNATURE_TTL_SEC;
    const rewardMode = REWARD_USDT;
    const rewardTarget = getAddress(USDT_ADDRESS);
    const rewardAmount = GAME_OPEN_CLAIM_REWARD_AMOUNT;

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
      outcomeId: `game-open-${gameId}-0.005`,
      outcomeType: "usdt",
      displayAmount: GAME_OPEN_CLAIM_USDT,
      rewardMode,
      rewardTarget,
      rewardAmount: rewardAmount.toString(),
      deadline,
      signature: signature as string,
      createdAt: Date.now(),
    };

    await saveShufflePending(record);
    await reserveGameOpenClaim({
      walletAddress: wallet,
      gameId,
      campaignId,
      nonce,
      signature: signature as string,
      deadline,
    });

    return NextResponse.json(formatSignResponse(record, gameId));
  } catch (err) {
    if (err instanceof GameOpenClaimError) {
      const status =
        err.code === "ALREADY_CLAIMED" || err.code === "TOO_SOON"
          ? 409
          : err.code === "NO_GAME" || err.code === "NOT_LIVE"
            ? 404
            : 400;
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status }
      );
    }
    const message =
      err instanceof Error ? err.message : "Failed to prepare game open claim.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function formatSignResponse(record: ShufflePendingRecord, gameId: string) {
  return {
    ok: true,
    gameId,
    campaignId: record.campaignId,
    nonce: record.nonce,
    deadline: record.deadline,
    signature: record.signature as Hex,
    rewardMode: record.rewardMode,
    rewardTarget: record.rewardTarget as Address,
    rewardAmount: record.rewardAmount,
    rewardUsdt: GAME_OPEN_CLAIM_USDT,
  };
}
