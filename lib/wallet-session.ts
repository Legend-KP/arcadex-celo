import { SignJWT, jwtVerify } from "jose";
import { verifyMessage } from "viem";
import { parseAuthChallengeMessage } from "@/lib/wallet-auth-message";
import { isWalletAddress, normalizeWalletAddress } from "@/lib/wallet-address";

const SESSION_TTL_SEC = 24 * 60 * 60;

function getWalletSessionSecret(): Uint8Array {
  const secret = process.env.WALLET_SESSION_SECRET?.trim();
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("WALLET_SESSION_SECRET is required in production.");
    }
    return new TextEncoder().encode("dev-wallet-session-secret-change-me");
  }
  return new TextEncoder().encode(secret);
}

export async function createWalletSessionToken(wallet: string): Promise<string> {
  const normalized = normalizeWalletAddress(wallet);
  return new SignJWT({ wallet: normalized })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SEC}s`)
    .sign(getWalletSessionSecret());
}

export async function verifyWalletSessionToken(
  token: string
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getWalletSessionSecret());
    const wallet = payload.wallet;
    if (typeof wallet !== "string" || !isWalletAddress(wallet)) return null;
    return normalizeWalletAddress(wallet);
  } catch {
    return null;
  }
}

export function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

export type WalletAuthResult =
  | { ok: true; wallet: string }
  | { ok: false; error: string; status: number };

export async function requireWalletAuth(
  request: Request,
  walletAddress?: string
): Promise<WalletAuthResult> {
  const token = extractBearerToken(request);
  if (!token) {
    return { ok: false, error: "Authentication required.", status: 401 };
  }

  const sessionWallet = await verifyWalletSessionToken(token);
  if (!sessionWallet) {
    return { ok: false, error: "Invalid or expired session.", status: 401 };
  }

  if (walletAddress) {
    const expected = normalizeWalletAddress(walletAddress);
    if (sessionWallet !== expected) {
      return {
        ok: false,
        error: "Wallet does not match authenticated session.",
        status: 403,
      };
    }
  }

  return { ok: true, wallet: sessionWallet };
}

export async function verifyWalletSignature(
  walletAddress: string,
  message: string,
  signature: string
): Promise<boolean> {
  const parsed = parseAuthChallengeMessage(message);
  if (!parsed) return false;

  const wallet = normalizeWalletAddress(walletAddress);
  if (parsed.wallet !== wallet) return false;

  try {
    return await verifyMessage({
      address: wallet as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}
