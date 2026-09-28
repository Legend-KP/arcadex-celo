import { NextResponse } from "next/server";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import {
  claimPendingStreakUsdt,
  listPendingStreakUsdt,
  StreakRewardError,
} from "@/lib/player-backend";
import { isStreakUsdtPayoutsEnabled } from "@/lib/streak-ladder-config";
import { microToUsdt } from "@/lib/streak-usdt-payout";
import { isWalletAddress, normalizeWalletAddress } from "@/lib/wallet-address";
import { requireWalletAuth } from "@/lib/wallet-session";

export const dynamic = "force-dynamic";

/**
 * List pending streak USDT entitlements for the authenticated wallet.
 * Amounts come from the server table + prior verified check-in grants.
 */
export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`streak-usdt-pending:${ip}`, 40, 60_000))) {
    return rateLimitResponse();
  }

  try {
    const { searchParams } = new URL(request.url);
    const rawWallet = searchParams.get("walletAddress")?.trim() ?? "";
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

    const pending = await listPendingStreakUsdt(wallet);
    return NextResponse.json({
      ok: true,
      payoutsEnabled: isStreakUsdtPayoutsEnabled(),
      pending: pending.map((row) => ({
        day: row.day,
        campaignId: row.campaignId,
        checkInTx: row.checkInTx,
        amountUsdt: microToUsdt(row.amountMicro),
        createdAt: row.createdAt,
      })),
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load pending USDT.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Shared MiniPay Claim path for D7 / D14 / D21 / D30 USDT.
 *
 * Security:
 * - wallet session required (matches body wallet)
 * - entitlement created only after verifyCheckInTx + ladder grant
 * - amount re-checked against server reward table
 * - one claim per check-in tx (payment_guards)
 * - daily USDT budget soft ceiling
 * - hot-wallet key never exposed to client
 */
export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`streak-usdt-claim:${ip}`, 15, 60_000))) {
    return rateLimitResponse();
  }

  try {
    if (!isStreakUsdtPayoutsEnabled()) {
      return NextResponse.json(
        {
          error: "Streak USDT payouts are not enabled yet.",
          code: "PAYOUTS_DISABLED",
        },
        { status: 503 }
      );
    }

    const body = (await request.json()) as {
      walletAddress?: string;
      checkInTx?: string;
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

    const checkInTx = body.checkInTx?.trim();
    const result = await claimPendingStreakUsdt(wallet, checkInTx);

    return NextResponse.json({
      ok: true,
      claimed: result.claimed,
      day: result.day,
      amountUsdt: result.amountUsdt,
      txHash: result.txHash,
    });
  } catch (err) {
    if (err instanceof StreakRewardError) {
      const status =
        err.code === "TX_ALREADY_USED" || err.code === "CLAIM_IN_PROGRESS"
          ? 409
          : err.code === "BUDGET" || err.code === "PAYOUT_FAILED"
            ? 503
            : 400;
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status }
      );
    }

    const message =
      err instanceof Error ? err.message : "Failed to claim streak USDT.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
