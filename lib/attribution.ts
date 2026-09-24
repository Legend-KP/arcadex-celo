import { toDataSuffix } from "@celo/attribution-tags";
import { concat, type Hex } from "viem";

/**
 * ArcadeX MiniPay attribution code (opaque token for Celo).
 * Override at build time with NEXT_PUBLIC_CELO_ATTRIBUTION_CODE when set.
 */
const APP_ATTRIBUTION_CODE =
  process.env.NEXT_PUBLIC_CELO_ATTRIBUTION_CODE?.trim() || "celo_9ycuxgyv";

let cachedSuffix: Hex | null = null;

export function getAttributionSuffix(): Hex {
  if (!cachedSuffix) {
    cachedSuffix = toDataSuffix(APP_ATTRIBUTION_CODE) as Hex;
  }
  return cachedSuffix;
}

/** Append attribution bytes for raw eth_sendTransaction calldata. */
export function appendAttributionSuffix(data: Hex): Hex {
  return concat([data, getAttributionSuffix()]);
}
