import type { IDKitResult } from "@worldcoin/idkit-core";

export function extractNullifierFromIdKitResult(
  result: IDKitResult
): string | null {
  const responses = "responses" in result ? result.responses : undefined;
  if (!responses?.length) return null;

  const first = responses[0];
  if ("nullifier" in first && first.nullifier) {
    return first.nullifier;
  }
  if ("session_nullifier" in first && first.session_nullifier?.[0]) {
    return first.session_nullifier[0];
  }
  return null;
}

export function nullifierDocId(nullifier: string): string {
  return nullifier.replace(/^0x/i, "").toLowerCase();
}
