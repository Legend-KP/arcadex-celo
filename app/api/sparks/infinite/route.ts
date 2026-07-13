import { NextResponse } from "next/server";
import {
  activateInfiniteSparkOnServer,
  InfiniteSparkActivationError,
} from "@/lib/rtdb-server";
import { normalizeWalletAddress } from "@/lib/wallet-address";
import { requireWalletAuth } from "@/lib/wallet-session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      walletAddress?: string;
      txHash?: string;
    };

    const rawWallet = body.walletAddress?.trim() ?? "";
    const txHash = body.txHash?.trim() ?? "";

    if (!rawWallet) {
      return NextResponse.json(
        { error: "walletAddress is required.", code: "NO_WALLET" },
        { status: 400 }
      );
    }

    if (!txHash) {
      return NextResponse.json(
        { error: "txHash is required.", code: "INVALID_TX" },
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

    const result = await activateInfiniteSparkOnServer(wallet, txHash);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof InfiniteSparkActivationError) {
      const status =
        err.code === "TX_ALREADY_USED"
          ? 409
          : err.code === "INVALID_TX"
            ? 400
            : 400;
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status }
      );
    }

    const message =
      err instanceof Error
        ? err.message
        : "Failed to activate Infinite Spark.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
