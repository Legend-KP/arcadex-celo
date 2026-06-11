import { NextResponse } from "next/server";
import { fetchUserFromServer, upsertUserOnServer } from "@/lib/rtdb-server";
import {
  isWalletAddress,
  normalizeWalletAddress,
  tryNormalizeWalletAddress,
} from "@/lib/wallet-address";

export const dynamic = "force-dynamic";

const NAME_RE = /^[\w\s.-]{1,20}$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id.trim()) {
      return NextResponse.json({ error: "User id required." }, { status: 400 });
    }

    const user = await fetchUserFromServer(id);
    return NextResponse.json({ user: user ?? null });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load player profile.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id.trim()) {
      return NextResponse.json({ error: "User id required." }, { status: 400 });
    }

    const body = (await request.json()) as {
      name?: string;
      walletAddress?: string;
    };

    const name = body.name?.trim() ?? "";
    if (!NAME_RE.test(name)) {
      return NextResponse.json(
        { error: "Name must be 1–20 characters (letters, numbers, spaces)." },
        { status: 400 }
      );
    }

    const wallet =
      tryNormalizeWalletAddress(body.walletAddress) ??
      (isWalletAddress(id) ? normalizeWalletAddress(id) : null);

    if (!wallet) {
      return NextResponse.json(
        { error: "Wallet address is required." },
        { status: 400 }
      );
    }

    const user = await upsertUserOnServer(wallet, {
      name,
      walletAddress: wallet,
    });

    return NextResponse.json({ user });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to save player profile.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
