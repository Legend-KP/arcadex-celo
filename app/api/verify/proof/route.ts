import { NextResponse } from "next/server";
import type { IDKitResult } from "@worldcoin/idkit-core";
import {
  fetchNullifierOwner,
  markUserHumanVerified,
  storeNullifier,
} from "@/lib/rtdb-server";
import { normalizeWalletAddress } from "@/lib/wallet-address";
import {
  extractNullifierFromIdKitResult,
  nullifierDocId,
} from "@/lib/world-id-nullifier";
import { getServerWorldIdConfig } from "@/lib/world-id-config";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      walletAddress?: string;
      idkitResponse?: IDKitResult;
    };

    const rawWallet = body.walletAddress?.trim() ?? "";
    if (!rawWallet || !body.idkitResponse) {
      return NextResponse.json(
        { error: "walletAddress and idkitResponse are required." },
        { status: 400 }
      );
    }

    const wallet = normalizeWalletAddress(rawWallet);
    const { rpId } = getServerWorldIdConfig();

    const verifyRes = await fetch(
      `https://developer.world.org/api/v4/verify/${rpId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body.idkitResponse),
      }
    );

    const verifyData = (await verifyRes.json()) as {
      success?: boolean;
      error?: string;
      detail?: string;
    };

    if (!verifyRes.ok || verifyData.success === false) {
      return NextResponse.json(
        {
          error:
            verifyData.error ??
            verifyData.detail ??
            "World ID proof verification failed.",
        },
        { status: 400 }
      );
    }

    const nullifier = extractNullifierFromIdKitResult(body.idkitResponse);
    if (!nullifier) {
      return NextResponse.json(
        { error: "Proof did not include a nullifier." },
        { status: 400 }
      );
    }

    const docId = nullifierDocId(nullifier);
    const existingOwner = await fetchNullifierOwner(docId);
    if (existingOwner && existingOwner !== wallet) {
      return NextResponse.json(
        { error: "This verification has already been used." },
        { status: 409 }
      );
    }

    if (!existingOwner) {
      await storeNullifier(docId, {
        nullifier,
        walletAddress: wallet,
      });
    }

    const user = await markUserHumanVerified(wallet, nullifier);
    return NextResponse.json({ verified: true, user });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not verify human proof.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
