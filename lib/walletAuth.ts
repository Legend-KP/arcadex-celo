"use client";

import {
  createMiniPayWalletClient,
  getInjectedProvider,
  isMiniPay,
} from "@/lib/minipay";
import {
  isWalletAddress,
  normalizeWalletAddress,
} from "@/lib/wallet-address";
import { clearInvalidCachedWallet, setCachedWallet } from "@/lib/player-id";

const POLL_MS = 200;
const MAX_WAIT_MS = 15000;

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

async function readAddressFromProvider(): Promise<string | null> {
  const client = createMiniPayWalletClient();
  if (!client) return null;

  try {
    const [address] = await client.getAddresses();
    if (isWalletAddress(address)) {
      return normalizeWalletAddress(address);
    }
  } catch {
    // Provider not ready yet
  }

  const provider = getInjectedProvider();
  if (!provider?.request) return null;

  try {
    const accounts = (await provider.request({
      method: "eth_accounts",
    })) as string[] | undefined;
    const first = accounts?.[0];
    if (first && isWalletAddress(first)) {
      return normalizeWalletAddress(first);
    }
  } catch {
    // Ignore — wallet may not be connected yet
  }

  return null;
}

/** Instant read — no provider polling. */
export function readWalletImmediately(): string | null {
  const cached = getMemoryCachedWallet();
  if (cached) return cached;
  return null;
}

async function waitForProviderWallet(
  timeoutMs = MAX_WAIT_MS
): Promise<string | null> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const wallet = await readAddressFromProvider();
    if (wallet) return wallet;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  return readAddressFromProvider();
}

/** Resolve wallet on app open via MiniPay injected provider (no message signing). */
export async function resolveWalletOnAppOpen(): Promise<string | null> {
  clearInvalidCachedWallet();

  const cached = getMemoryCachedWallet();
  if (cached) return cached;

  const immediate = await readAddressFromProvider();
  if (immediate) return cacheWallet(immediate);

    const fromProvider = await waitForProviderWallet(1200);
  if (fromProvider) return cacheWallet(fromProvider);

  return null;
}

/** Quick re-read after auto-connect — avoids repeating the full init wait. */
export async function retryResolveWallet(): Promise<string | null> {
  const cached = getMemoryCachedWallet();
  if (cached) return cached;

  const immediate = await readAddressFromProvider();
  if (immediate) return cacheWallet(immediate);

    const fromProvider = await waitForProviderWallet(1200);
  return fromProvider ? cacheWallet(fromProvider) : null;
}

function walletInitErrorMessage(): string {
  if (!isMiniPay()) {
    return "Open ArcadeX inside MiniPay to continue.";
  }
  return "Could not connect to your MiniPay wallet. Update MiniPay and try again.";
}

/** Resolve wallet for saving profile — address-only, no SIWE (MiniPay constraint). */
export async function resolveWalletForSave(): Promise<string> {
  const silent = await resolveWalletOnAppOpen();
  if (silent) return silent;

  const wallet = await waitForProviderWallet();
  if (wallet) return cacheWallet(wallet);

  throw new Error(walletInitErrorMessage());
}
