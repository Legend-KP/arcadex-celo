/**
 * D1 persistence for Daily XP Board counters, ledger, and bans.
 */

import { utcDayKey } from "@/lib/activity-week";
import {
  coerceDailyXpCounters,
  compareDailyXpEntries,
  computeDailyXp,
  dailyXpEntryFromCounters,
  DAILY_XP_LEADERBOARD_MAX_ENTRIES,
  DAILY_XP_PLAY_COOLDOWN_MS,
  emptyDailyXpCounters,
  getUtcDayWindow,
  isDailyXpLive,
  type DailyXpCounters,
  type DailyXpEventKind,
  type DailyXpLeaderboardEntry,
  type DailyXpClaimRecord,
} from "@/lib/daily-xp-board";
import {
  d1BatchFirst,
  requireD1,
  type D1DatabaseLike,
  type D1PreparedStatement,
} from "@/lib/d1-client";
import { scrubSecrets } from "@/lib/firebase-admin";
import {
  isWalletAddress,
  normalizeWalletAddress,
} from "@/lib/wallet-address";

type DailyXpRow = {
  wallet: string;
  utc_day: string;
  plays: number;
  checked_in: number;
  spend_units: number;
  last_play_at: number | null;
  updated_at: number | null;
  name: string | null;
};

type DailyXpLbRow = {
  utc_day: string;
  wallet: string;
  name: string;
  score: number;
  plays: number;
  checked_in: number;
  spend_units: number;
  updated_at: number | null;
};

type DailyXpClaimRow = {
  wallet: string;
  utc_day: string;
  status: string;
  campaign_id: number;
  nonce: number | null;
  reward_amount: string | null;
  signature: string | null;
  deadline: number | null;
  tx_hash: string | null;
  created_at: number;
  claimed_at: number | null;
};

export type { DailyXpClaimRecord };

function rowToCounters(row: DailyXpRow | null | undefined): DailyXpCounters {
  if (!row) return emptyDailyXpCounters();
  return coerceDailyXpCounters({
    plays: row.plays,
    checkedIn: row.checked_in === 1,
    spendUnits: row.spend_units,
    lastPlayAt: row.last_play_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
    name: row.name ?? undefined,
  });
}

function claimRowToRecord(row: DailyXpClaimRow): DailyXpClaimRecord {
  const status =
    row.status === "claimed" || row.status === "forfeited"
      ? row.status
      : "pending";
  return {
    wallet: row.wallet,
    utcDay: row.utc_day,
    status,
    campaignId: row.campaign_id,
    nonce: row.nonce ?? undefined,
    rewardAmount: row.reward_amount ?? undefined,
    signature: row.signature ?? undefined,
    deadline: row.deadline ?? undefined,
    txHash: row.tx_hash ?? undefined,
    createdAt: row.created_at,
    claimedAt: row.claimed_at ?? undefined,
  };
}

function countersStatement(
  db: D1DatabaseLike,
  wallet: string,
  utcDay: string,
  counters: DailyXpCounters
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO user_daily_xp (
         wallet, utc_day, plays, checked_in, spend_units,
         last_play_at, updated_at, name
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(wallet, utc_day) DO UPDATE SET
         plays = excluded.plays,
         checked_in = excluded.checked_in,
         spend_units = excluded.spend_units,
         last_play_at = excluded.last_play_at,
         updated_at = excluded.updated_at,
         name = excluded.name`
    )
    .bind(
      wallet,
      utcDay,
      counters.plays,
      counters.checkedIn ? 1 : 0,
      counters.spendUnits,
      counters.lastPlayAt ?? null,
      counters.updatedAt ?? null,
      counters.name ?? null
    );
}

function leaderboardStatement(
  db: D1DatabaseLike,
  utcDay: string,
  entry: DailyXpLeaderboardEntry
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO daily_xp_leaderboard_entries (
         utc_day, wallet, name, score, plays, checked_in, spend_units, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(utc_day, wallet) DO UPDATE SET
         name = excluded.name,
         score = excluded.score,
         plays = excluded.plays,
         checked_in = excluded.checked_in,
         spend_units = excluded.spend_units,
         updated_at = excluded.updated_at`
    )
    .bind(
      utcDay,
      entry.walletAddress,
      entry.name,
      entry.score,
      entry.plays ?? 0,
      entry.checkedIn ? 1 : 0,
      entry.spendUnits ?? 0,
      entry.updatedAt ?? null
    );
}

export async function recordDailyXpEventOnD1(
  walletAddress: string,
  kind: DailyXpEventKind,
  opts?: { spendUnits?: number; name?: string }
): Promise<void> {
  try {
    // Daily XP only counts from Saturday 00:00 UTC go-live onward.
    if (!isDailyXpLive()) return;
    if (!isWalletAddress(walletAddress)) return;
    const wallet = normalizeWalletAddress(walletAddress);
    const now = Date.now();
    const { dayKey } = getUtcDayWindow(now);
    const spendUnits =
      kind === "spend" &&
      typeof opts?.spendUnits === "number" &&
      Number.isFinite(opts.spendUnits)
        ? Math.max(0, Math.floor(opts.spendUnits))
        : 0;

    const db = await requireD1();
    const profileNameOpt = opts?.name?.trim() || "";

    const [userRes, dailyRes] = await db.batch([
      db.prepare(`SELECT name FROM users WHERE wallet = ?`).bind(wallet),
      db
        .prepare(
          `SELECT wallet, utc_day, plays, checked_in, spend_units,
                  last_play_at, updated_at, name
           FROM user_daily_xp WHERE wallet = ? AND utc_day = ?`
        )
        .bind(wallet, dayKey),
    ]);

    const profileName =
      profileNameOpt ||
      String(d1BatchFirst<{ name: string }>(userRes)?.name ?? "").trim();

    const existing = rowToCounters(d1BatchFirst<DailyXpRow>(dailyRes));
    const next: DailyXpCounters = { ...existing };

    if (kind === "play") {
      if (
        typeof next.lastPlayAt === "number" &&
        now - next.lastPlayAt < DAILY_XP_PLAY_COOLDOWN_MS
      ) {
        return;
      }
      next.plays += 1;
      next.lastPlayAt = now;
    }

    if (kind === "check_in") {
      if (next.checkedIn) return;
      next.checkedIn = true;
    }

    if (kind === "spend" && spendUnits > 0) {
      next.spendUnits += spendUnits;
    }

    if (profileName) next.name = profileName;
    next.updatedAt = now;

    const writes: D1PreparedStatement[] = [
      countersStatement(db, wallet, dayKey, next),
    ];
    const score = computeDailyXp(next);
    if (score > 0) {
      writes.push(
        leaderboardStatement(db, dayKey, dailyXpEntryFromCounters(wallet, next))
      );
    }
    await db.batch(writes);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[ArcadeX][daily-xp] recordDailyXpEvent failed: ${scrubSecrets(message)}`
    );
  }
}

export async function fetchDailyXpLeaderboardFromD1(
  utcDay = utcDayKey(),
  limit = DAILY_XP_LEADERBOARD_MAX_ENTRIES
): Promise<DailyXpLeaderboardEntry[]> {
  const db = await requireD1();
  const { results } = await db
    .prepare(
      `SELECT utc_day, wallet, name, score, plays, checked_in, spend_units, updated_at
       FROM daily_xp_leaderboard_entries
       WHERE utc_day = ? AND score > 0
       ORDER BY score DESC, updated_at ASC
       LIMIT ?`
    )
    .bind(utcDay, Math.max(1, limit))
    .all<DailyXpLbRow>();

  return (results ?? [])
    .map((row) => ({
      name: row.name,
      score: row.score,
      walletAddress: row.wallet,
      plays: row.plays,
      checkedIn: row.checked_in === 1,
      spendUnits: row.spend_units,
      updatedAt: row.updated_at ?? undefined,
    }))
    .sort(compareDailyXpEntries)
    .slice(0, limit);
}

export async function fetchUserDailyXpFromD1(
  walletAddress: string,
  utcDay = utcDayKey()
): Promise<DailyXpCounters> {
  if (!isWalletAddress(walletAddress)) return emptyDailyXpCounters();
  const wallet = normalizeWalletAddress(walletAddress);
  const db = await requireD1();
  const row = await db
    .prepare(
      `SELECT wallet, utc_day, plays, checked_in, spend_units,
              last_play_at, updated_at, name
       FROM user_daily_xp WHERE wallet = ? AND utc_day = ?`
    )
    .bind(wallet, utcDay)
    .first<DailyXpRow>();
  return rowToCounters(row);
}

export async function isDailyXpBannedOnD1(
  walletAddress: string
): Promise<boolean> {
  if (!isWalletAddress(walletAddress)) return false;
  const wallet = normalizeWalletAddress(walletAddress);
  const db = await requireD1();
  const row = await db
    .prepare(`SELECT wallet FROM daily_xp_bans WHERE wallet = ?`)
    .bind(wallet)
    .first<{ wallet: string }>();
  return Boolean(row?.wallet);
}

export async function setDailyXpBanOnD1(
  walletAddress: string,
  banned: boolean,
  opts?: { reason?: string; bannedBy?: string }
): Promise<void> {
  if (!isWalletAddress(walletAddress)) return;
  const wallet = normalizeWalletAddress(walletAddress);
  const db = await requireD1();
  if (!banned) {
    await db
      .prepare(`DELETE FROM daily_xp_bans WHERE wallet = ?`)
      .bind(wallet)
      .run();
    return;
  }
  await db
    .prepare(
      `INSERT INTO daily_xp_bans (wallet, reason, banned_at, banned_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(wallet) DO UPDATE SET
         reason = excluded.reason,
         banned_at = excluded.banned_at,
         banned_by = excluded.banned_by`
    )
    .bind(
      wallet,
      opts?.reason ?? null,
      Date.now(),
      opts?.bannedBy ?? null
    )
    .run();
}

export async function getDailyXpClaimOnD1(
  walletAddress: string,
  utcDay = utcDayKey()
): Promise<DailyXpClaimRecord | null> {
  if (!isWalletAddress(walletAddress)) return null;
  const wallet = normalizeWalletAddress(walletAddress);
  const db = await requireD1();
  const row = await db
    .prepare(
      `SELECT wallet, utc_day, status, campaign_id, nonce, reward_amount,
              signature, deadline, tx_hash, created_at, claimed_at
       FROM daily_xp_claims WHERE wallet = ? AND utc_day = ?`
    )
    .bind(wallet, utcDay)
    .first<DailyXpClaimRow>();
  return row ? claimRowToRecord(row) : null;
}

/** Insert pending claim if none exists. Returns existing or new. */
export async function reserveDailyXpClaimOnD1(opts: {
  walletAddress: string;
  utcDay: string;
  campaignId: number;
  nonce: number;
  rewardAmount: string;
  signature: string;
  deadline: number;
}): Promise<{ record: DailyXpClaimRecord; created: boolean }> {
  const wallet = normalizeWalletAddress(opts.walletAddress);
  const existing = await getDailyXpClaimOnD1(wallet, opts.utcDay);
  if (existing) {
    return { record: existing, created: false };
  }

  const createdAt = Date.now();
  const db = await requireD1();
  try {
    await db
      .prepare(
        `INSERT INTO daily_xp_claims (
           wallet, utc_day, status, campaign_id, nonce, reward_amount,
           signature, deadline, created_at
         ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        wallet,
        opts.utcDay,
        opts.campaignId,
        opts.nonce,
        opts.rewardAmount,
        opts.signature,
        opts.deadline,
        createdAt
      )
      .run();
  } catch {
    const raced = await getDailyXpClaimOnD1(wallet, opts.utcDay);
    if (raced) return { record: raced, created: false };
    throw new Error("Failed to reserve daily XP claim.");
  }

  return {
    record: {
      wallet,
      utcDay: opts.utcDay,
      status: "pending",
      campaignId: opts.campaignId,
      nonce: opts.nonce,
      rewardAmount: opts.rewardAmount,
      signature: opts.signature,
      deadline: opts.deadline,
      createdAt,
    },
    created: true,
  };
}

export async function updateDailyXpClaimPendingOnD1(opts: {
  walletAddress: string;
  utcDay: string;
  campaignId: number;
  nonce: number;
  rewardAmount: string;
  signature: string;
  deadline: number;
}): Promise<DailyXpClaimRecord | null> {
  const wallet = normalizeWalletAddress(opts.walletAddress);
  const db = await requireD1();
  await db
    .prepare(
      `UPDATE daily_xp_claims
       SET campaign_id = ?, nonce = ?, reward_amount = ?, signature = ?,
           deadline = ?, status = 'pending'
       WHERE wallet = ? AND utc_day = ? AND status = 'pending'`
    )
    .bind(
      opts.campaignId,
      opts.nonce,
      opts.rewardAmount,
      opts.signature,
      opts.deadline,
      wallet,
      opts.utcDay
    )
    .run();
  return getDailyXpClaimOnD1(wallet, opts.utcDay);
}

export async function markDailyXpClaimedOnD1(opts: {
  walletAddress: string;
  utcDay: string;
  txHash: string;
}): Promise<DailyXpClaimRecord | null> {
  const wallet = normalizeWalletAddress(opts.walletAddress);
  const db = await requireD1();
  const claimedAt = Date.now();
  await db
    .prepare(
      `UPDATE daily_xp_claims
       SET status = 'claimed', tx_hash = ?, claimed_at = ?
       WHERE wallet = ? AND utc_day = ? AND status != 'claimed'`
    )
    .bind(opts.txHash.toLowerCase(), claimedAt, wallet, opts.utcDay)
    .run();
  return getDailyXpClaimOnD1(wallet, opts.utcDay);
}
