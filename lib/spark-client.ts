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
