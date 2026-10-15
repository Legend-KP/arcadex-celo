import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Hot-wallet claim path retired for Option C (per-game on-chain SHUFFLE).
 * Use POST /api/game-open-claim/claim-sign + claim-sync instead.
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        "Game open claims are on-chain. Use /api/game-open-claim/claim-sign.",
      code: "USE_ONCHAIN",
    },
    { status: 410 }
  );
}
