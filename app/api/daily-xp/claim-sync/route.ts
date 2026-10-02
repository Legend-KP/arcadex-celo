import { NextResponse } from "next/server";
import type { Hash } from "viem";
import {
  REWARD_USDT,
  isArcadeXRewardsConfigured,
} from "@/lib/arcadex-rewards";
import { verifySpinTx } from "@/lib/arcadex-rewards-verify";
import {
  DAILY_XP_CAMPAIGN_ID,
  DAILY_XP_REWARD_AMOUNT,
  getUtcDayWindow,
  isDailyXpLive,
} from "@/lib/daily-xp-board";
import {
  getDailyXpClaim,
  isDailyXpBanned,
  markDailyXpClaimed,
} from "@/lib/daily-xp-store";
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
  if (!(await checkRateLimit(`daily-xp-claim-sync:${ip}`, 20, 60_000))) {
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
      txHash?: string;
      campaignId?: number;
      nonce?: number;
    };

    const rawWallet = body.walletAddress?.trim() ?? "";
    const txHash = body.txHash?.trim() ?? "";
    const campaignId =
      typeof body.campaignId === "number" && Number.isFinite(body.campaignId)
        ? body.campaignId
        : DAILY_XP_CAMPAIGN_ID;
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
    if (campaignId !== DAILY_XP_CAMPAIGN_ID) {
      return NextResponse.json(
        { error: "Invalid Daily XP campaign.", code: "WRONG_CAMPAIGN" },
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

    if (await isDailyXpBanned(wallet)) {
      return NextResponse.json(
        { error: "This wallet is not eligible to claim.", code: "BANNED" },
        { status: 403 }
      );
    }

    const day = getUtcDayWindow();
    const claim = await getDailyXpClaim(wallet, day.dayKey);
    if (claim?.status === "claimed") {
      return NextResponse.json({
        ok: true,
        alreadyClaimed: true,
        needsClaim: true,
        campaignId,
        nonce,
        utcDay: day.dayKey,
      });
    }

    const pending = await getShufflePending(wallet, campaignId, nonce);
    if (!pending) {
      return NextResponse.json(
        { error: "No pending Daily XP claim for this nonce.", code: "NO_PENDING" },
        { status: 400 }
      );
    }
    if (pending.rewardAmount !== DAILY_XP_REWARD_AMOUNT.toString()) {
      return NextResponse.json(
        { error: "Pending reward amount mismatch.", code: "MISMATCH" },
        { status: 400 }
      );
    }

    let verified;
    try {
      verified = await verifySpinTx(wallet, txHash as Hash, campaignId);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Invalid spin transaction.";
      return NextResponse.json(
        { error: message, code: "INVALID_TX" },
        { status: 400 }
      );
    }

    if (Number(verified.rewardMode) !== REWARD_USDT) {
      return NextResponse.json(
        { error: "On-chain reward mode mismatch.", code: "MISMATCH" },
        { status: 400 }
      );
    }
    if (verified.rewardAmount.toString() !== DAILY_XP_REWARD_AMOUNT.toString()) {
      return NextResponse.json(
        { error: "On-chain amount mismatch.", code: "MISMATCH" },
        { status: 400 }
      );
    }

    await recordSpinTxOnServer(wallet, txHash, campaignId, pending.outcomeId);
    await markShufflePendingConsumed(wallet, campaignId, nonce, txHash);
    await markDailyXpClaimed({
      walletAddress: wallet,
      utcDay: day.dayKey,
      txHash,
    });

    return NextResponse.json({
      ok: true,
      alreadyClaimed: false,
      needsClaim: true,
      campaignId,
      nonce,
      utcDay: day.dayKey,
      rewardUsdt: pending.displayAmount,
    });
  } catch (err) {
    if (err instanceof StreakSyncError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code === "TX_ALREADY_USED" ? 409 : 400 }
      );
    }
    const message =
      err instanceof Error ? err.message : "Failed to sync Daily XP claim.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
