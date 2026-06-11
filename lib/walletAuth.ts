"use client";

import type {
  MiniAppWalletAuthPayload,
  WalletAuthResult,
} from "@worldcoin/minikit-js/commands";
import { MiniKit } from "@worldcoin/minikit-js";
import {
  isWalletAddress,
  normalizeWalletAddress,
} from "@/lib/wallet-address";
import { clearInvalidCachedWallet, setCachedWallet } from "@/lib/player-id";
import { getWorldAppPublicConfig } from "@/lib/world-app-config";

const WALLET_AUTH_STATEMENT = "Sign in to ArcadeX";
const MINIKIT_POLL_MS = 200;
const MINIKIT_MAX_WAIT_MS = 15000;
const AUTH_MAX_ATTEMPTS = 2;

type WorldAppGlobals = {
  WorldApp?: {
    wallet_address?: string;
  };
};

type WalletAuthPayload = WalletAuthResult | MiniAppWalletAuthPayload;

let memoryCachedWallet: string | null = null;

export function getMemoryCachedWallet(): string | null {
  const fromMemory = memoryCachedWallet;
  if (isWalletAddress(fromMemory)) {
    return normalizeWalletAddress(fromMemory!);
  }
  return getCachedWalletFromStorage();
}

function getCachedWalletFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("arcadex_wallet_address");
  if (!isWalletAddress(raw)) return null;
  return normalizeWalletAddress(raw!);
}

function cacheWallet(address: string): string {
  const normalized = normalizeWalletAddress(address);
  memoryCachedWallet = normalized;
  setCachedWallet(normalized);
  return normalized;
}

function isWalletAuthError(
  payload: WalletAuthPayload
): payload is Extract<MiniAppWalletAuthPayload, { status: "error" }> {
  return "status" in payload && payload.status === "error";
}

function isWalletAuthSuccess(
  payload: WalletAuthPayload | undefined
): payload is WalletAuthPayload & { address: string; signature: string } {
  if (!payload || isWalletAuthError(payload)) return false;
  if (!payload.address?.trim() || !payload.signature?.trim()) return false;
  if ("status" in payload && payload.status !== "success") return false;
  return true;
}

/** Call install when World App bridge is present (safe to call repeatedly). */
export function tryInstallMiniKit(): boolean {
  const appId = getMiniKitAppId();
  if (!appId || typeof window === "undefined") return false;
  if (MiniKit.isInstalled()) return true;

  const worldApp = (window as Window & WorldAppGlobals).WorldApp;
  if (!worldApp) return false;

  const result = MiniKit.install(appId);
  return result.success && MiniKit.isInstalled();
}

export function getMiniKitAppId(): string | undefined {
  const fromRuntime = getWorldAppPublicConfig().appId;
  if (fromRuntime) return fromRuntime;

  return (
    process.env.NEXT_PUBLIC_APP_ID?.trim() ||
    process.env.NEXT_PUBLIC_WORLD_APP_ID?.trim() ||
    undefined
  );
}

/** MiniKitProvider calls install(); poll until World App init completes. */
export async function ensureMiniKitReady(): Promise<boolean> {
  if (!getMiniKitAppId()) {
    console.warn("World App ID is not configured (NEXT_PUBLIC_APP_ID).");
    return false;
  }

  const start = Date.now();
  while (Date.now() - start < MINIKIT_MAX_WAIT_MS) {
    tryInstallMiniKit();
    if (MiniKit.isInstalled()) return true;
    await new Promise((r) => setTimeout(r, MINIKIT_POLL_MS));
  }

  return MiniKit.isInstalled();
}

async function waitForMiniKit(): Promise<boolean> {
  return ensureMiniKitReady();
}

async function fetchSiweNonce(): Promise<string> {
  const res = await fetch("/api/nonce", { cache: "no-store" });
  const data = (await res.json()) as { nonce?: string; error?: string };
  if (!res.ok || !data.nonce) {
    throw new Error(data.error ?? "Could not fetch auth nonce.");
  }
  return data.nonce;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `Request failed (${path}).`);
  }
  return data;
}

export function getWorldUsername(): string | undefined {
  if (!MiniKit.isInstalled()) return undefined;
  const username = MiniKit.user?.username?.trim();
  return username || undefined;
}

/** Wallet address injected by World App at mini-app launch (no sign-in prompt). */
export function getWorldAppWalletAddress(): string | null {
  if (typeof window === "undefined") return null;

  const fromBridge = (window as Window & WorldAppGlobals).WorldApp?.wallet_address;
  if (isWalletAddress(fromBridge)) {
    return normalizeWalletAddress(fromBridge!);
  }

  if (MiniKit.isInstalled()) {
    const fromUser = MiniKit.user?.walletAddress;
    if (isWalletAddress(fromUser)) {
      return normalizeWalletAddress(fromUser!);
    }
  }

  return null;
}

/** Poll until World App exposes the wallet (injected async on some devices). */
async function waitForWorldAppWallet(
  timeoutMs = MINIKIT_MAX_WAIT_MS
): Promise<string | null> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const wallet = getWorldAppWalletAddress();
    if (wallet) return wallet;
    await new Promise((r) => setTimeout(r, MINIKIT_POLL_MS));
  }

  return getWorldAppWalletAddress();
}

/** Instant read — no MiniKit polling (use before background resolve). */
export function readWalletImmediately(): string | null {
  const cached = getMemoryCachedWallet();
  if (cached) return cached;

  const fromWorld = getWorldAppWalletAddress();
  if (fromWorld) return cacheWallet(fromWorld);

  return null;
}

/** Resolve wallet on app open — uses World App injection, not SIWE. */
export async function resolveWalletOnAppOpen(): Promise<string | null> {
  clearInvalidCachedWallet();

  const cached = getMemoryCachedWallet();
  if (cached) return cached;

  await ensureMiniKitReady();

  const immediate = getWorldAppWalletAddress();
  if (immediate) return cacheWallet(immediate);

  const fromWorld = await waitForWorldAppWallet(2000);
  if (fromWorld) return cacheWallet(fromWorld);

  return null;
}

/** Quick re-read after ensureMiniKitReady — avoids repeating the full init wait. */
export async function retryResolveWallet(): Promise<string | null> {
  const cached = getMemoryCachedWallet();
  if (cached) return cached;

  const immediate = getWorldAppWalletAddress();
  if (immediate) return cacheWallet(immediate);

  const fromWorld = await waitForWorldAppWallet(2000);
  return fromWorld ? cacheWallet(fromWorld) : null;
}

function walletInitErrorMessage(): string {
  if (!getMiniKitAppId()) {
    return "ArcadeX app ID is not configured. Set NEXT_PUBLIC_APP_ID in your environment.";
  }
  if (!MiniKit.isInWorldApp()) {
    return "Open ArcadeX inside World App to continue.";
  }
  return "Could not connect to World App. Update World App and try again.";
}

/** Silent read first; falls back to World App wallet sign-in when saving. */
export async function resolveWalletForSave(): Promise<string> {
  const silent = await resolveWalletOnAppOpen();
  if (silent) return silent;

  return authenticateWalletWithRetry();
}

async function authenticateWalletOnce(): Promise<string> {
  clearInvalidCachedWallet();

  const cached = getMemoryCachedWallet();
  if (cached) return cached;

  const ready = await waitForMiniKit();
  if (!ready || !MiniKit.isInstalled()) {
    throw new Error(walletInitErrorMessage());
  }

  const nonce = await fetchSiweNonce();

  // minikit-js v2: MiniKit.walletAuth() returns { data, executedWith }.
  // commandsAsync is removed in v2 — do not use finalPayload here.
  const result = await MiniKit.walletAuth({
    nonce,
    statement: WALLET_AUTH_STATEMENT,
    expirationTime: new Date(Date.now() + 1000 * 60 * 60),
  });

  const payload = result.data as WalletAuthPayload;
  if (!isWalletAuthSuccess(payload)) {
    const rejected =
      payload !== undefined &&
      isWalletAuthError(payload) &&
      payload.error_code === "user_rejected";
    throw new Error(
      rejected
        ? "Wallet sign-in was cancelled."
        : "Wallet sign-in was cancelled or failed."
    );
  }

  const response = await apiPost<{ isValid: boolean; address?: string }>(
    "/api/complete-siwe",
    { payload, nonce }
  );

  if (!response.isValid || !response.address) {
    throw new Error("Wallet signature verification failed.");
  }

  return cacheWallet(response.address);
}

export async function authenticateWalletWithRetry(): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < AUTH_MAX_ATTEMPTS; attempt++) {
    try {
      return await authenticateWalletOnce();
    } catch (err) {
      lastError = err;
      memoryCachedWallet = null;
      clearInvalidCachedWallet();
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Wallet authentication failed.");
}
