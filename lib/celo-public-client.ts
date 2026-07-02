import {
  createPublicClient,
  custom,
  http,
} from "viem";
import { celo } from "viem/chains";
import { getInjectedProvider, isMiniPay } from "@/lib/minipay";

const CELO_RPC_URL = "https://forno.celo.org";

const publicClientConfig = {
  chain: celo,
  batch: { multicall: false },
  cacheTime: 0,
} as const;

function createFornoClient() {
  return createPublicClient({
    ...publicClientConfig,
    transport: http(CELO_RPC_URL),
  });
}

type CeloPublicClient = ReturnType<typeof createFornoClient>;

function createBrowserPublicClient(): CeloPublicClient {
  if (typeof window !== "undefined" && isMiniPay()) {
    const provider = getInjectedProvider();
    if (provider) {
      return createPublicClient({
        ...publicClientConfig,
        transport: custom(provider),
      }) as unknown as CeloPublicClient;
    }
  }

  return createFornoClient();
}

let browserClient: CeloPublicClient | null = null;

/** Public client for browser-side chain reads (payments, balances). */
export function getCeloPublicClient(): CeloPublicClient {
  if (typeof window !== "undefined") {
    browserClient ??= createBrowserPublicClient();
    return browserClient;
  }

  return createFornoClient();
}

/** Reset cached browser client (e.g. after RPC "block is out of range"). */
export function resetCeloPublicClient(): void {
  browserClient = null;
}

export function isBlockOutOfRangeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("block is out of range");
}

type ReadContractParams = Parameters<CeloPublicClient["readContract"]>[0];

export async function readCeloContract(
  params: ReadContractParams
): Promise<bigint> {
  const read = () =>
    getCeloPublicClient().readContract({
      ...params,
      blockTag: "latest",
    });

  try {
    return (await read()) as bigint;
  } catch (error) {
    if (!isBlockOutOfRangeError(error)) throw error;
    resetCeloPublicClient();
    return (await read()) as bigint;
  }
}
