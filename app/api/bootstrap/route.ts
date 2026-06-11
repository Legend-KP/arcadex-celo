import { NextResponse } from "next/server";
import { bootstrapUserOnServer } from "@/lib/rtdb-server";
import { normalizeWalletAddress } from "@/lib/wallet-address";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      walletAddress?: string;
    };

    const rawWallet = body.walletAddress?.trim() ?? "";
    if (!rawWallet) {
      return NextResponse.json(
        { error: "walletAddress is required." },
        { status: 400 }
      );
    }

    const wallet = normalizeWalletAddress(rawWallet);
    const user = await bootstrapUserOnServer(wallet);
    return NextResponse.json({ user });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to bootstrap user.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
