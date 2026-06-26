import { SparkSnapshot, StoredSparkState } from "@/types";
import { defaultSparkState, computeSparkSnapshot } from "@/lib/spark";

export interface SparkApiResponse {
  state: StoredSparkState;
  sparks: SparkSnapshot;
}

export async function fetchSparkData(
  walletAddress: string
): Promise<SparkApiResponse> {
  const res = await fetch(
    `/api/sparks?walletAddress=${encodeURIComponent(walletAddress)}`,
    { cache: "no-store" }
  );

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "Could not load Sparks.");
  }

  return (await res.json()) as SparkApiResponse;
}

export function localSparkData(): SparkApiResponse {
  const state = defaultSparkState();
  return { state, sparks: computeSparkSnapshot(state) };
}

export interface SparkSpendResponse extends SparkApiResponse {
  spent: boolean;
}

export async function spendSpark(
  walletAddress: string
): Promise<SparkSpendResponse> {
  const res = await fetch("/api/sparks/spend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress }),
    cache: "no-store",
  });

  const data = (await res.json().catch(() => ({}))) as SparkSpendResponse & {
    error?: string;
    code?: string;
  };

  if (!res.ok) {
    throw new Error(data.error ?? "Could not spend Spark.");
  }

  return data;
}

export interface InfiniteSparkActivateResponse extends SparkApiResponse {
  activated: boolean;
}

export async function activateInfiniteSpark(
  walletAddress: string,
  txHash: string
): Promise<InfiniteSparkActivateResponse> {
  const res = await fetch("/api/sparks/infinite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress, txHash }),
    cache: "no-store",
  });

  const data = (await res.json().catch(() => ({}))) as InfiniteSparkActivateResponse & {
    error?: string;
    code?: string;
  };

  if (!res.ok) {
    throw new Error(data.error ?? "Could not activate Infinite Spark.");
  }

  return data;
}

export interface SparkRefillActivateResponse extends SparkApiResponse {
  refilled: boolean;
}

export async function activateSparkRefill(
  walletAddress: string,
  txHash: string
): Promise<SparkRefillActivateResponse> {
  const res = await fetch("/api/sparks/refill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress, txHash }),
    cache: "no-store",
  });

  const data = (await res.json().catch(() => ({}))) as SparkRefillActivateResponse & {
    error?: string;
    code?: string;
  };

  if (!res.ok) {
    throw new Error(data.error ?? "Could not activate Spark Refill.");
  }

  return data;
}
