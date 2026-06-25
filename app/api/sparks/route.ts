import { NextResponse } from "next/server";
import { fetchSparkStateFromServer } from "@/lib/rtdb-server";
import { computeSparkSnapshot } from "@/lib/spark";
import { normalizeWalletAddress } from "@/lib/wallet-address";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawWallet = searchParams.get("walletAddress")?.trim() ?? "";

    if (!rawWallet) {
      return NextResponse.json(
        { error: "walletAddress is required." },
        { status: 400 }
      );
    }

    const wallet = normalizeWalletAddress(rawWallet);
    const state = await fetchSparkStateFromServer(wallet);
    const sparks = computeSparkSnapshot(state);
    return NextResponse.json({ state, sparks });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load sparks.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
