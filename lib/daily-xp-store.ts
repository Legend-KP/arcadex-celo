/**
 * Daily XP store facade (D1 or RTDB).
 */

import { useD1PlayerData } from "@/lib/d1-client";
import * as d1Daily from "@/lib/d1-daily-xp";
import {
  type DailyXpClaimRecord,
  type DailyXpCounters,
  type DailyXpEventKind,
  type DailyXpLeaderboardEntry,
} from "@/lib/daily-xp-board";
import * as rtdb from "@/lib/rtdb-server";
import { scheduleWorkerWork } from "@/lib/worker-context";

export type { DailyXpClaimRecord };

async function withDailyXpBackend<T>(
  d1Fn: () => Promise<T>,
  rtdbFn: () => Promise<T>
): Promise<T> {
  if (await useD1PlayerData()) return d1Fn();
  return rtdbFn();
}

export async function recordDailyXpEvent(
  walletAddress: string,
  kind: DailyXpEventKind,
  opts?: { spendUnits?: number; name?: string }
): Promise<void> {
  return withDailyXpBackend(
    () => d1Daily.recordDailyXpEventOnD1(walletAddress, kind, opts),
    () => rtdb.recordDailyXpBoardEvent(walletAddress, kind, opts)
  );
}

export function recordDailyXpEventBestEffort(
  walletAddress: string,
  kind: DailyXpEventKind,
  opts?: { spendUnits?: number; name?: string }
): void {
  scheduleWorkerWork(recordDailyXpEvent(walletAddress, kind, opts));
}

export async function fetchDailyXpLeaderboardFromServer(
  utcDay?: string,
  limit?: number
): Promise<DailyXpLeaderboardEntry[]> {
  return withDailyXpBackend(
    () => d1Daily.fetchDailyXpLeaderboardFromD1(utcDay, limit),
    () => rtdb.fetchDailyXpBoardFromServer(utcDay, limit)
  );
}

export async function fetchUserDailyXpFromServer(
  walletAddress: string,
  utcDay?: string
): Promise<DailyXpCounters> {
  return withDailyXpBackend(
    () => d1Daily.fetchUserDailyXpFromD1(walletAddress, utcDay),
    () => rtdb.fetchUserDailyXpCounters(walletAddress, utcDay)
  );
}

export async function isDailyXpBanned(
  walletAddress: string
): Promise<boolean> {
  return withDailyXpBackend(
    () => d1Daily.isDailyXpBannedOnD1(walletAddress),
    () => rtdb.isDailyXpWalletBanned(walletAddress)
  );
}

export async function setDailyXpBan(
  walletAddress: string,
  banned: boolean,
  opts?: { reason?: string; bannedBy?: string }
): Promise<void> {
  return withDailyXpBackend(
    () => d1Daily.setDailyXpBanOnD1(walletAddress, banned, opts),
    () => rtdb.setDailyXpWalletBan(walletAddress, banned, opts)
  );
}

export async function getDailyXpClaim(
  walletAddress: string,
  utcDay?: string
): Promise<DailyXpClaimRecord | null> {
  return withDailyXpBackend(
    () => d1Daily.getDailyXpClaimOnD1(walletAddress, utcDay),
    () => rtdb.getDailyXpClaimRecord(walletAddress, utcDay)
  );
}

export async function reserveDailyXpClaim(
  opts: Parameters<typeof d1Daily.reserveDailyXpClaimOnD1>[0]
): Promise<{ record: DailyXpClaimRecord; created: boolean }> {
  return withDailyXpBackend(
    () => d1Daily.reserveDailyXpClaimOnD1(opts),
    () => rtdb.reserveDailyXpClaimRecord(opts)
  );
}

export async function updateDailyXpClaimPending(
  opts: Parameters<typeof d1Daily.updateDailyXpClaimPendingOnD1>[0]
): Promise<DailyXpClaimRecord | null> {
  return withDailyXpBackend(
    () => d1Daily.updateDailyXpClaimPendingOnD1(opts),
    () => rtdb.updateDailyXpClaimPendingRecord(opts)
  );
}

export async function markDailyXpClaimed(
  opts: Parameters<typeof d1Daily.markDailyXpClaimedOnD1>[0]
): Promise<DailyXpClaimRecord | null> {
  return withDailyXpBackend(
    () => d1Daily.markDailyXpClaimedOnD1(opts),
    () => rtdb.markDailyXpClaimRecord(opts)
  );
}
