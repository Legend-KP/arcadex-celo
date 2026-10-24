import { getD1 } from "@/lib/d1-client";
import { normalizeWalletAddress } from "@/lib/wallet-address";

export type WalletSignInRow = {
  id: number;
  wallet: string;
  nonce: string;
  issuedAt: string;
  signedAt: number;
  signature: string;
};

type WalletSignInDbRow = {
  id: number;
  wallet: string;
  nonce: string;
  issued_at: string;
  signed_at: number;
  signature: string;
};

export async function recordWalletSignIn(opts: {
  wallet: string;
  nonce: string;
  issuedAt: string;
  signature: string;
}): Promise<void> {
  try {
    const db = await getD1();
    if (!db) return;
    await db
      .prepare(
        `INSERT INTO wallet_signins (wallet, nonce, issued_at, signed_at, signature)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(
        normalizeWalletAddress(opts.wallet),
        opts.nonce,
        opts.issuedAt,
        Date.now(),
        opts.signature
      )
      .run();
  } catch (err) {
    console.error("wallet sign-in log failed", err);
  }
}

export async function listWalletSignIns(limit = 100): Promise<WalletSignInRow[]> {
  const db = await getD1();
  if (!db) return [];
  const capped = Math.min(200, Math.max(1, limit));
  const result = await db
    .prepare(
      `SELECT id, wallet, nonce, issued_at, signed_at, signature
       FROM wallet_signins
       ORDER BY signed_at DESC
       LIMIT ?`
    )
    .bind(capped)
    .all<WalletSignInDbRow>();

  return (result.results ?? []).map((row) => ({
    id: row.id,
    wallet: row.wallet,
    nonce: row.nonce,
    issuedAt: row.issued_at,
    signedAt: row.signed_at,
    signature: row.signature,
  }));
}
