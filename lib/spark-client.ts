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

const SPARK_ENTRY_PREFIX = "arcadex:spark-entry:";

export function sparkEntryKey(walletAddress: string, gameId: string): string {
  return `${SPARK_ENTRY_PREFIX}${walletAddress}:${gameId}`;
}

/** Skip duplicate spend on refresh / Strict Mode within 60s. */
export function shouldSpendSparkForEntry(
  walletAddress: string,
  gameId: string
): boolean {
  if (typeof sessionStorage === "undefined") return true;

  const raw = sessionStorage.getItem(sparkEntryKey(walletAddress, gameId));
  if (!raw) return true;

  const spentAt = Number.parseInt(raw, 10);
  return !Number.isFinite(spentAt) || Date.now() - spentAt > 60_000;
}

export function markSparkSpentForEntry(
  walletAddress: string,
  gameId: string
): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(
    sparkEntryKey(walletAddress, gameId),
    Date.now().toString()
  );
}

export interface SparkSpendResponse extends SparkApiResponse {
  spent: boolean;
}

export async function spendSparkForEntry(
  walletAddress: string,
  gameId: string
): Promise<SparkSpendResponse> {
  if (!shouldSpendSparkForEntry(walletAddress, gameId)) {
    const data = await fetchSparkData(walletAddress);
    return { ...data, spent: false };
  }

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

  if (data.spent) {
    markSparkSpentForEntry(walletAddress, gameId);
  }

  return data;
}
