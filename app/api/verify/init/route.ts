import { NextResponse } from "next/server";
import { signRequest } from "@worldcoin/idkit/signing";
import {
  getPublicWorldAppId,
  getServerWorldIdConfig,
  HUMAN_VERIFY_ACTION,
} from "@/lib/world-id-config";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const { signingKey, rpId } = getServerWorldIdConfig();
    const appId = getPublicWorldAppId();

    if (!appId) {
      return NextResponse.json(
        { error: "NEXT_PUBLIC_APP_ID is not configured." },
        { status: 500 }
      );
    }

    const signed = signRequest({
      signingKeyHex: signingKey,
      action: HUMAN_VERIFY_ACTION,
    });

    return NextResponse.json({
      app_id: appId,
      action: HUMAN_VERIFY_ACTION,
      rp_context: {
        rp_id: rpId,
        nonce: signed.nonce,
        created_at: signed.createdAt,
        expires_at: signed.expiresAt,
        signature: signed.sig,
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not init human verification.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
