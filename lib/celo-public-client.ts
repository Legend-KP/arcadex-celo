import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";

const DEFAULT_RPC_URLS = [
  "https://forno.celo.org",
  "https://rpc.ankr.com/celo",
  "https://1rpc.io/celo",
] as const;

function getRpcUrls(): string[] {
  const primary = process.env.NEXT_PUBLIC_CELO_RPC_URL?.trim();
  const urls = primary
    ? [primary, ...DEFAULT_RPC_URLS.filter((url) => url !== primary)]
    : [...DEFAULT_RPC_URLS];
  return [...new Set(urls)];
}

const publicClientConfig = {
  chain: celo,
  batch: { multicall: false },
  cacheTime: 0,
} as const;

function createHttpClient(rpcUrl: string) {
  return createPublicClient({
    ...publicClientConfig,
    transport: http(rpcUrl, { timeout: 12_000 }),
  });
}

type CeloPublicClient = ReturnType<typeof createHttpClient>;

let browserClient: CeloPublicClient | null = null;
let browserClientIndex = 0;

function createBrowserPublicClient(): CeloPublicClient {
  const urls = getRpcUrls();
  const url = urls[browserClientIndex % urls.length] ?? urls[0]!;
  return createHttpClient(url);
}

/** Public client for browser-side chain reads (payments, balances). */
export function getCeloPublicClient(): CeloPublicClient {
  if (typeof window !== "undefined") {
    browserClient ??= createBrowserPublicClient();
    return browserClient;
  }

  return createHttpClient(getRpcUrls()[0]!);
}

/** Reset cached browser client and rotate to the next RPC URL. */
export function resetCeloPublicClient(): void {
  browserClient = null;
  const urls = getRpcUrls();
  if (urls.length > 0) {
    browserClientIndex = (browserClientIndex + 1) % urls.length;
  }
}

function collectErrorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const parts: string[] = [error.message];
  let cause: unknown = error.cause;
  while (cause instanceof Error) {
    parts.push(cause.message);
    cause = cause.cause;
  }
  return parts.join(" ");
}

export function isBlockOutOfRangeError(error: unknown): boolean {
  const message = collectErrorText(error).toLowerCase();
  return (
    message.includes("block is out of range") ||
    message.includes("header not found") ||
    message.includes("invalid block tag")
  );
}

function isTransientRpcError(error: unknown): boolean {
  const message = collectErrorText(error).toLowerCase();
  return (
    isBlockOutOfRangeError(error) ||
    message.includes("timeout") ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("503") ||
    message.includes("502")
  );
}

function isTransactionFailureError(error: unknown): boolean {
  const message = collectErrorText(error).toLowerCase();
  return (
    message.includes("transaction receipt") ||
    message.includes("could not be found") ||
    message.includes("not mined") ||
    message.includes("execution reverted") ||
    message.includes("transaction failed") ||
    message.includes("version: viem")
  );
}

/** Map low-level RPC errors to short user-facing messages. */
export function formatChainError(error: unknown): string {
  if (error instanceof Error) {
    if (
      error.message.includes("Insufficient balance") ||
      error.message.includes("Connect your wallet") ||
      error.message.includes("No wallet") ||
      error.message.includes("approval failed") ||
      error.message.includes("payment failed")
    ) {
      return error.message;
    }
  }

  if (isTransactionFailureError(error)) {
    return "Transaction failed. Please try again.";
  }

  if (isTransientRpcError(error)) {
    return "The network is temporarily unavailable. Please wait a moment and try again.";
  }

  if (error instanceof Error) {
    if (
      error.message.includes("RPC Request failed") ||
      error.message.includes("Request body") ||
      error.message.length > 160
    ) {
      return "Could not reach the Celo network. Please try again.";
    }
    return error.message;
  }

  return "Something went wrong. Please try again.";
}

type ReadContractParams = Parameters<CeloPublicClient["readContract"]>[0];

const RETRY_DELAYS_MS = [0, 400, 900];

export async function readCeloContract(
  params: ReadContractParams
): Promise<bigint> {
  let lastError: unknown;

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      resetCeloPublicClient();
    }

    try {
      return (await getCeloPublicClient().readContract({
        ...params,
        blockTag: "latest",
      })) as bigint;
    } catch (error) {
      lastError = error;
      if (!isTransientRpcError(error)) throw error;
    }
  }

  for (const rpcUrl of getRpcUrls()) {
    try {
      return (await createHttpClient(rpcUrl).readContract({
        ...params,
        blockTag: "latest",
      })) as bigint;
    } catch (error) {
      lastError = error;
      if (!isTransientRpcError(error)) throw error;
    }
  }

  throw lastError;
}
