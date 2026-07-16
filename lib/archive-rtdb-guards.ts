/**
 * Priority 6 (low urgency) — archive RTDB payment / guard nodes.
 *
 * Paths that grow forever today:
 *   sparkPayments/{txHash}
 *   scorePayments/{txHash}
 *   checkInTxs/{txHash}
 *   streakGrants/{txHash}
 *
 * Replay protection only needs a realistic retry window (~90 days), not forever.
 *
 * Suggested job (run monthly via cron / Worker scheduled trigger):
 * 1. Page each root with RTDB REST shallow / limit queries (or export).
 * 2. For entries with activatedAt/syncedAt/grantedAt older than 90 days:
 *    - Append JSONL to R2 / GCS / BigQuery cold storage.
 *    - DELETE the RTDB leaf.
 * 3. Keep a short bloom/set of recent hashes in RTDB (or just rely on the
 *    remaining nodes) so retries within the window still fail closed.
 *
 * Do not run this until play-counter + leaderboard + spark transaction
 * optimizations (P1–P3) are deployed and verified.
 *
 * This file is intentionally a stub — wire credentials and scheduling when ready.
 */

export const GUARD_ARCHIVE_ROOTS = [
  "sparkPayments",
  "scorePayments",
  "checkInTxs",
  "streakGrants",
] as const;

export const GUARD_ARCHIVE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export function isGuardRecordExpired(
  record: { activatedAt?: number; syncedAt?: number; grantedAt?: number },
  now = Date.now()
): boolean {
  const ts = record.activatedAt ?? record.syncedAt ?? record.grantedAt;
  if (typeof ts !== "number" || !Number.isFinite(ts)) return false;
  return now - ts > GUARD_ARCHIVE_MAX_AGE_MS;
}

/** Placeholder — implement export + delete when ops schedules this job. */
export async function archiveExpiredGuardRecords(): Promise<{
  scanned: number;
  archived: number;
}> {
  throw new Error(
    "archiveExpiredGuardRecords is not implemented yet. See lib/archive-rtdb-guards.ts."
  );
}
