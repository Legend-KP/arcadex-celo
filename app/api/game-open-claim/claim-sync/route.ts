import { NextResponse } from "next/server";
import type { Hash } from "viem";
import {
  REWARD_USDT,
  isArcadeXRewardsConfigured,
} from "@/lib/arcadex-rewards";
import { verifySpinTx } from "@/lib/arcadex-rewards-verify";
import { isGameOpenClaimEnabled } from "@/lib/feature-flags";
import { GAME_OPEN_CLAIM_REWARD_AMOUNT } from "@/lib/game-open-claim";
import {
  GameOpenClaimError,
  markGameOpenClaimed,
  requireGameOpenCampaign,
} from "@/lib/game-open-claim-server";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import {
  getShufflePending,
  markShufflePendingConsumed,
  recordSpinTxOnServer,
  StreakSyncError,
} from "@/lib/player-backend";
import { isWalletAddress, normalizeWalletAddress } from "@/lib/wallet-address";
import { requireWalletAuth } from "@/lib/wallet-session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`game-open-claim-sync:${ip}`, 20, 60_000))) {
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
      txHash?: string;
      campaignId?: number;
      nonce?: number;
    };

    const rawWallet = body.walletAddress?.trim() ?? "";
    const gameId = body.gameId?.trim() ?? "";
    const txHash = body.txHash?.trim() ?? "";
    const nonce =
      typeof body.nonce === "number" && Number.isFinite(body.nonce)
        ? body.nonce
        : -1;

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
    if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      return NextResponse.json(
        { error: "txHash is required.", code: "INVALID_TX" },
        { status: 400 }
      );
    }
    if (nonce < 0) {
      return NextResponse.json(
        { error: "nonce is required.", code: "INVALID_NONCE" },
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

    const expectedCampaign = await requireGameOpenCampaign(gameId);
    const campaignId =
      typeof body.campaignId === "number" && Number.isFinite(body.campaignId)
        ? body.campaignId
        : expectedCampaign;
    if (campaignId !== expectedCampaign) {
      return NextResponse.json(
        { error: "Campaign does not match this game.", code: "WRONG_CAMPAIGN" },
        { status: 400 }
      );
    }

    const pending = await getShufflePending(wallet, campaignId, nonce);
    if (!pending || pending.rewardAmount !== GAME_OPEN_CLAIM_REWARD_AMOUNT.toString()) {
      return NextResponse.json(
        { error: "No matching signed game-open spin found.", code: "NO_PENDING" },
        { status: 400 }
      );
    }

    const verified = await verifySpinTx(wallet, txHash as Hash, campaignId);
    if (verified.rewardMode !== REWARD_USDT) {
      return NextResponse.json(
        { error: "Spin reward mode is not USDT.", code: "BAD_REWARD" },
        { status: 400 }
      );
    }
    if (verified.rewardAmount !== GAME_OPEN_CLAIM_REWARD_AMOUNT) {
      return NextResponse.json(
        { error: "Spin amount does not match 0.012 USDT.", code: "BAD_AMOUNT" },
        { status: 400 }
      );
    }

    try {
      await recordSpinTxOnServer(
        wallet,
        txHash,
        campaignId,
        pending.outcomeId
      );
    } catch (err) {
      if (err instanceof StreakSyncError && err.code === "TX_ALREADY_USED") {
        // idempotent
      } else {
        throw err;
      }
    }

    await markShufflePendingConsumed(wallet, campaignId, nonce, txHash);
    await markGameOpenClaimed({
      walletAddress: wallet,
      gameId,
      campaignId,
      spinTx: txHash,
    });

    return NextResponse.json({
      ok: true,
      needsClaim: verified.rewardMode === REWARD_USDT,
      campaignId,
      gameId,
    });
  } catch (err) {
    if (err instanceof GameOpenClaimError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 400 }
      );
    }
    const message =
      err instanceof Error ? err.message : "Failed to sync game open claim.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
