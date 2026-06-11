import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** MiniKit 2.x requires alphanumeric nonce (8+ chars, no hyphens). */
function generateNonce(length = 16): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export async function GET() {
  return NextResponse.json({ nonce: generateNonce() });
}
