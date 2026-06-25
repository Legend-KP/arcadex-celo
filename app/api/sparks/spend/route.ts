import { NextResponse } from "next/server";
import { spendSparkOnServer, SparkSpendError } from "@/lib/rtdb-server";
import { normalizeWalletAddress } from "@/lib/wallet-address";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { walletAddress?: string };
    const rawWallet = body.walletAddress?.trim() ?? "";

    if (!rawWallet) {
      return NextResponse.json(
        { error: "walletAddress is required.", code: "NO_WALLET" },
        { status: 400 }
      );
    }

    const wallet = normalizeWalletAddress(rawWallet);
    const result = await spendSparkOnServer(wallet);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SparkSpendError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code === "NO_SPARKS" ? 402 : 400 }
      );
    }

    const message =
      err instanceof Error ? err.message : "Failed to spend Spark.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
