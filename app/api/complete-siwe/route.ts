import { NextResponse } from "next/server";
import type {
  MiniAppWalletAuthSuccessPayload,
  WalletAuthResult,
} from "@worldcoin/minikit-js/commands";
import { verifySiweMessage } from "@worldcoin/minikit-js/siwe";
import { normalizeWalletAddress } from "@/lib/wallet-address";

export const dynamic = "force-dynamic";

const WALLET_AUTH_STATEMENT = "Sign in to ArcadeX";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      payload?: WalletAuthResult | MiniAppWalletAuthSuccessPayload;
      nonce?: string;
    };

    const { payload, nonce } = body;
    if (!payload || !nonce?.trim()) {
      return NextResponse.json(
        { isValid: false, error: "Missing payload or nonce" },
        { status: 400 }
      );
    }

    const verification = await verifySiweMessage(
      payload,
      nonce,
      WALLET_AUTH_STATEMENT
    );

    if (!verification.isValid || !verification.siweMessageData.address) {
      return NextResponse.json(
        { isValid: false, error: "Invalid wallet signature" },
        { status: 401 }
      );
    }

    const address = normalizeWalletAddress(
      verification.siweMessageData.address
    );

    return NextResponse.json({ isValid: true, address });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Wallet verification failed";
    return NextResponse.json(
      { isValid: false, error: message },
      { status: 400 }
    );
  }
}
