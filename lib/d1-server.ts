/**
 * D1-backed player-data API — same signatures as lib/rtdb-server.ts.
 * Game gating flags stay on RTDB (not implemented here).
 */

import {
  GameProgress,
  LEADERBOARD_MAX_ENTRIES,
  CONTEST_MAX_ENTRIES,
  LeaderboardEntry,
  PlayerProfile,
  StoredGameProgress,
  StoredSparkState,
} from "@/types";
import {
  SPARK_MAX,
  computeSparkSnapshot,
  defaultSparkState,
  findReadySparkSlotIndex,
  normalizeSparkState,
} from "@/lib/spark";
import { INFINITE_SPARK_DURATION_MS } from "@/lib/infinite-spark";
import { verifyInfiniteSparkPaymentTx } from "@/lib/infinite-spark-verify";
import { verifySparkRefillPaymentTx } from "@/lib/spark-refill-verify";
import { verifyScoreSubmitPaymentTx } from "@/lib/score-submit-verify";
import type { Hash } from "viem";
import { requireD1, type D1DatabaseLike } from "@/lib/d1-client";
import {
  bumpCachedPlayCount,
  getCachedPlayCounts,
  invalidateSharedPlayCountsCache,
  invalidateSharedPlayCountsKv,
  loadPlayCountsWithSharedCache,
  mergeCachedPlayCounts,
} from "@/lib/rtdb-cache";
import { coalesceProgressWrite } from "@/lib/progress-write-coalesce";
import {
  isWalletAddress,
  normalizeWalletAddress,
  tryNormalizeWalletAddress,
} from "@/lib/wallet-address";
import { SHUFFLE_DAILY_USDT_BUDGET_MICRO } from "@/lib/shuffle-outcomes";
import {
  GameStateConflictError,
  InfiniteSparkActivationError,
  ScoreSubmitActivationError,
  SparkRefillActivationError,
  SparkSpendError,
  StreakRewardError,
  StreakSyncError,
  type GameStateRecord,
  type ShufflePendingRecord,
} from "@/lib/rtdb-server";

type StoredUser = Omit<PlayerProfile, "id">;

const D1_TX_MAX_RETRIES = 8;

type GuardKind =
  | "spark_payment"
  | "score_payment"
  | "check_in_tx"
  | "streak_grant"
  | "spin_tx"
  | "shuffle_grant";

type GuardClaimResult<T extends Record<string, unknown>> =
  | { status: "created"; record: T }
  | { status: "exists"; record: T }
  | { status: "conflict_other_wallet" };

type SparksRow = {
  wallet: string;
  max: number;
  regen_ms: number;
  slots_json: string;
  infinite_until: number | null;
};

type ProgressRow = {
  wallet: string;
  game_id: string;
  s: number | null;
  l: number | null;
  st_json: string | null;
  r: number | null;
};

type LeaderboardRow = {
  game_id: string;
  player_key: string;
  name: string;
  score: number;
  wallet: string | null;
  created_at: number | null;
};

type BudgetRow = {
  day_key: string;
  spent_micro: number;
  reservations_json: string;
  confirmed_json: string;
};

type ShuffleUsdtReservation = {
  amountMicro: number;
  expiresAt: number;
};

type ShuffleDailyBudgetRecord = {
  spentMicro?: number;
  reservations?: Record<string, ShuffleUsdtReservation>;
  confirmed?: Record<string, number>;
};

function resolveWalletField(
  id: string,
  walletAddress?: string
): string | undefined {
  const fromBody = tryNormalizeWalletAddress(walletAddress);
  if (fromBody) return fromBody;
  if (isWalletAddress(id)) return normalizeWalletAddress(id);
  return undefined;
}

function toPlayerProfile(id: string, data: StoredUser | null): PlayerProfile | null {
  if (!data) return null;
  return { id, ...data };
}

/** Ready slots stay null in D1 JSON (unlike RTDB's 0 sentinel). */
function sparkStateForD1(state: StoredSparkState): {
  max: number;
  regen_ms: number;
  slots_json: string;
  infinite_until: number | null;
} {
  return {
    max: state.max,
    regen_ms: state.regenMs,
    slots_json: JSON.stringify(state.slots),
    infinite_until: state.infiniteUntil ?? null,
  };
}

function sparksRowToState(row: SparksRow | null): StoredSparkState | null {
  if (!row) return null;
  let slots: unknown = [];
  try {
    slots = JSON.parse(row.slots_json);
  } catch {
    slots = [];
  }
  return normalizeSparkState({
    max: row.max,
    regenMs: row.regen_ms,
    slots,
    ...(row.infinite_until ? { infiniteUntil: row.infinite_until } : {}),
  });
}

async function readSparksRow(
  db: D1DatabaseLike,
  wallet: string
): Promise<SparksRow | null> {
  return db
    .prepare(
      `SELECT wallet, max, regen_ms, slots_json, infinite_until FROM sparks WHERE wallet = ?`
    )
    .bind(wallet)
    .first<SparksRow>();
}

async function writeSparksState(
  db: D1DatabaseLike,
  wallet: string,
  state: StoredSparkState
): Promise<void> {
  const packed = sparkStateForD1(state);
  await db
    .prepare(
      `INSERT INTO sparks (wallet, max, regen_ms, slots_json, infinite_until)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(wallet) DO UPDATE SET
         max = excluded.max,
         regen_ms = excluded.regen_ms,
         slots_json = excluded.slots_json,
         infinite_until = excluded.infinite_until`
    )
    .bind(
      wallet,
      packed.max,
      packed.regen_ms,
      packed.slots_json,
      packed.infinite_until
    )
    .run();
}

function progressRowToStored(row: ProgressRow | null): StoredGameProgress | null {
  if (!row) return null;
  const stored: StoredGameProgress = {};
  if (typeof row.s === "number") stored.s = row.s;
  if (typeof row.l === "number") stored.l = row.l;
  if (typeof row.r === "number") stored.r = row.r;
  if (row.st_json) {
    try {
      const st = JSON.parse(row.st_json) as unknown;
      if (st && typeof st === "object" && !Array.isArray(st)) {
        stored.st = st as Record<string, unknown>;
      }
    } catch {
      // ignore bad JSON
    }
  }
  return stored;
}

async function readProgressRow(
  db: D1DatabaseLike,
  wallet: string,
  gameId: string
): Promise<ProgressRow | null> {
  return db
    .prepare(
      `SELECT wallet, game_id, s, l, st_json, r FROM game_progress WHERE wallet = ? AND game_id = ?`
    )
    .bind(wallet, gameId)
    .first<ProgressRow>();
}

async function upsertProgressRow(
  db: D1DatabaseLike,
  wallet: string,
  gameId: string,
  stored: StoredGameProgress
): Promise<void> {
  const stJson =
    stored.st && typeof stored.st === "object"
      ? JSON.stringify(stored.st)
      : null;
  await db
    .prepare(
      `INSERT INTO game_progress (wallet, game_id, s, l, st_json, r)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(wallet, game_id) DO UPDATE SET
         s = excluded.s,
         l = excluded.l,
         st_json = excluded.st_json,
         r = excluded.r`
    )
    .bind(
      wallet,
      gameId,
      typeof stored.s === "number" ? stored.s : null,
      typeof stored.l === "number" ? stored.l : null,
      stJson,
      typeof stored.r === "number" ? stored.r : null
    )
    .run();
}

function leaderboardUserKey(entry: LeaderboardEntry): string {
  const wallet = tryNormalizeWalletAddress(entry.walletAddress);
  if (wallet) return `wallet:${wallet}`;
  return `name:${entry.name.trim().toLowerCase()}`;
}

function leaderboardStorageKey(entry: LeaderboardEntry): string {
  const wallet = tryNormalizeWalletAddress(entry.walletAddress);
  if (wallet) return wallet;
  return `name_${entry.name.trim().toLowerCase().replace(/[.#$[\]/]/g, "_")}`;
}

function rowToLeaderboardEntry(row: LeaderboardRow): LeaderboardEntry {
  return {
    name: row.name,
    score: row.score,
    ...(row.wallet ? { walletAddress: row.wallet } : {}),
    ...(typeof row.created_at === "number" ? { createdAt: row.created_at } : {}),
  };
}

/** Kind prefix keeps RTDB namespaces (check-in vs streak grant) on one PK. */
function guardPrimaryKey(kind: GuardKind, txHash: string): string {
  return `${kind}:${txHash}`;
}

async function claimGuardRecord(
  txHash: string,
  kind: GuardKind,
  wallet: string,
  buildRecord: () => Record<string, unknown>
): Promise<GuardClaimResult<Record<string, unknown>>> {
  const db = await requireD1();
  const record = buildRecord();
  const usedAt =
    typeof record.activatedAt === "number"
      ? record.activatedAt
      : typeof record.syncedAt === "number"
        ? record.syncedAt
        : typeof record.grantedAt === "number"
          ? record.grantedAt
          : Date.now();
  const pk = guardPrimaryKey(kind, txHash);

  const insert = await db
    .prepare(
      `INSERT OR IGNORE INTO payment_guards (tx_hash, kind, wallet, extra_json, used_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(pk, kind, wallet, JSON.stringify(record), usedAt)
    .run();

  if (insert.meta?.changes === 1) {
    return { status: "created", record };
  }

  const existing = await db
    .prepare(
      `SELECT wallet, extra_json FROM payment_guards WHERE tx_hash = ?`
    )
    .bind(pk)
    .first<{ wallet: string; extra_json: string | null }>();

  if (!existing?.wallet) {
    throw new Error("Failed to claim payment guard.");
  }

  const recorded = normalizeWalletAddress(String(existing.wallet));
  let existingRecord: Record<string, unknown> = { wallet: recorded };
  if (existing.extra_json) {
    try {
      existingRecord = {
        ...JSON.parse(existing.extra_json),
        wallet: recorded,
      };
    } catch {
      existingRecord = { wallet: recorded };
    }
  }

  if (recorded === wallet) {
    return { status: "exists", record: existingRecord };
  }
  return { status: "conflict_other_wallet" };
}

async function readGuardWallet(
  txHash: string,
  kind: GuardKind
): Promise<{ wallet: string; extra: Record<string, unknown> } | null> {
  const db = await requireD1();
  const row = await db
    .prepare(`SELECT wallet, extra_json FROM payment_guards WHERE tx_hash = ?`)
    .bind(guardPrimaryKey(kind, txHash))
    .first<{ wallet: string; extra_json: string | null }>();
  if (!row?.wallet) return null;
  let extra: Record<string, unknown> = {};
  if (row.extra_json) {
    try {
      extra = JSON.parse(row.extra_json) as Record<string, unknown>;
    } catch {
      extra = {};
    }
  }
  return { wallet: normalizeWalletAddress(String(row.wallet)), extra };
}

async function deleteGuard(txHash: string, kind: GuardKind): Promise<void> {
  const db = await requireD1();
  await db
    .prepare(`DELETE FROM payment_guards WHERE tx_hash = ?`)
    .bind(guardPrimaryKey(kind, txHash))
    .run();
}

function pruneExpiredReservations(
  reservations: Record<string, ShuffleUsdtReservation> | undefined,
  nowMs: number
): Record<string, ShuffleUsdtReservation> {
  if (!reservations) return {};
  const next: Record<string, ShuffleUsdtReservation> = {};
  for (const [key, value] of Object.entries(reservations)) {
    if (
      value &&
      typeof value.amountMicro === "number" &&
      typeof value.expiresAt === "number" &&
      value.expiresAt > nowMs &&
      value.amountMicro > 0
    ) {
      next[key] = value;
    }
  }
  return next;
}

function sumReservedMicro(
  reservations: Record<string, ShuffleUsdtReservation>
): number {
  let sum = 0;
  for (const value of Object.values(reservations)) {
    sum += value.amountMicro;
  }
  return sum;
}

function parseBudgetRow(row: BudgetRow | null): ShuffleDailyBudgetRecord {
  if (!row) return {};
  let reservations: Record<string, ShuffleUsdtReservation> = {};
  let confirmed: Record<string, number> = {};
  try {
    reservations = JSON.parse(row.reservations_json || "{}") as Record<
      string,
      ShuffleUsdtReservation
    >;
  } catch {
    reservations = {};
  }
  try {
    confirmed = JSON.parse(row.confirmed_json || "{}") as Record<string, number>;
  } catch {
    confirmed = {};
  }
  return {
    spentMicro: row.spent_micro,
    reservations,
    confirmed,
  };
}

async function writeBudgetRow(
  db: D1DatabaseLike,
  dayKey: string,
  record: ShuffleDailyBudgetRecord
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO shuffle_daily_budget (day_key, spent_micro, reservations_json, confirmed_json)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(day_key) DO UPDATE SET
         spent_micro = excluded.spent_micro,
         reservations_json = excluded.reservations_json,
         confirmed_json = excluded.confirmed_json`
    )
    .bind(
      dayKey,
      typeof record.spentMicro === "number" ? record.spentMicro : 0,
      JSON.stringify(record.reservations ?? {}),
      JSON.stringify(record.confirmed ?? {})
    )
    .run();
}

export function shuffleUtcDayKey(nowMs: number = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function shuffleUsdtReservationKey(
  walletAddress: string,
  campaignId: number,
  nonce: number
): string {
  return `${normalizeWalletAddress(walletAddress)}_${campaignId}_${nonce}`;
}

// ─── Users ───────────────────────────────────────────────────────────────────

export async function fetchUserFromServer(
  id: string
): Promise<PlayerProfile | null> {
  const wallet = tryNormalizeWalletAddress(id);
  if (!wallet) return null;

  const db = await requireD1();
  const row = await db
    .prepare(
      `SELECT wallet, name, created_at, updated_at FROM users WHERE wallet = ?`
    )
    .bind(wallet)
    .first<{
      wallet: string;
      name: string;
      created_at: number;
      updated_at: number;
    }>();

  if (!row) return null;
  return toPlayerProfile(wallet, {
    name: row.name,
    walletAddress: row.wallet,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export async function upsertUserOnServer(
  id: string,
  data: { name: string; walletAddress?: string }
): Promise<PlayerProfile> {
  const wallet = resolveWalletField(id, data.walletAddress);
  if (!wallet) {
    throw new Error("A wallet address is required to save a player profile.");
  }

  const existing = await fetchUserFromServer(wallet);
  const now = Date.now();
  const stored: StoredUser = {
    name: data.name.trim(),
    walletAddress: wallet,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const db = await requireD1();
  await db
    .prepare(
      `INSERT INTO users (wallet, name, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(wallet) DO UPDATE SET
         name = excluded.name,
         updated_at = excluded.updated_at`
    )
    .bind(wallet, stored.name, stored.createdAt, stored.updatedAt)
    .run();

  return toPlayerProfile(wallet, stored)!;
}

export async function bootstrapUserOnServer(
  walletAddress: string
): Promise<PlayerProfile> {
  if (!isWalletAddress(walletAddress)) {
    throw new Error("bootstrap requires a valid wallet address.");
  }

  const wallet = normalizeWalletAddress(walletAddress);
  const existing = await fetchUserFromServer(wallet);

  if (!existing) {
    const now = Date.now();
    const stored: StoredUser = {
      name: "",
      walletAddress: wallet,
      createdAt: now,
      updatedAt: now,
    };
    const db = await requireD1();
    await db
      .prepare(
        `INSERT INTO users (wallet, name, created_at, updated_at) VALUES (?, ?, ?, ?)`
      )
      .bind(wallet, "", now, now)
      .run();
    await writeSparksState(db, wallet, defaultSparkState());
    return toPlayerProfile(wallet, stored)!;
  }

  await ensureSparkStateOnServer(wallet);
  return existing;
}

// ─── Sparks ───────────────────────────────────────────────────────────────────

export async function readSparkStateFromServer(
  walletAddress: string
): Promise<StoredSparkState> {
  if (!isWalletAddress(walletAddress)) {
    throw new Error("A valid wallet address is required.");
  }

  const wallet = normalizeWalletAddress(walletAddress);
  const db = await requireD1();
  const row = await readSparksRow(db, wallet);
  if (!row) return defaultSparkState();
  return sparksRowToState(row) ?? defaultSparkState();
}

/** @deprecated Use readSparkStateFromServer — GET must not create rows. */
export async function fetchSparkStateFromServer(
  walletAddress: string
): Promise<StoredSparkState> {
  return readSparkStateFromServer(walletAddress);
}

export async function ensureSparkStateOnServer(
  walletAddress: string
): Promise<StoredSparkState> {
  const wallet = normalizeWalletAddress(walletAddress);
  const db = await requireD1();
  const existing = await readSparksRow(db, wallet);

  if (existing) {
    const normalized = sparksRowToState(existing)!;
    const packed = sparkStateForD1(normalized);
    const needsRewrite =
      existing.max < SPARK_MAX ||
      packed.slots_json !== existing.slots_json ||
      packed.regen_ms !== existing.regen_ms ||
      packed.infinite_until !== (existing.infinite_until ?? null);
    if (needsRewrite) {
      await writeSparksState(db, wallet, normalized);
    }
    return normalized;
  }

  const initial = defaultSparkState();
  await writeSparksState(db, wallet, initial);
  return initial;
}

export async function getSparkSnapshotFromServer(
  walletAddress: string
): Promise<ReturnType<typeof computeSparkSnapshot>> {
  const state = await readSparkStateFromServer(walletAddress);
  return computeSparkSnapshot(state);
}

export async function spendSparkOnServer(
  walletAddress: string
): Promise<{
  state: StoredSparkState;
  sparks: ReturnType<typeof computeSparkSnapshot>;
  spent: boolean;
}> {
  if (!isWalletAddress(walletAddress)) {
    throw new SparkSpendError(
      "A valid wallet address is required.",
      "NO_WALLET"
    );
  }

  const wallet = normalizeWalletAddress(walletAddress);
  const now = Date.now();
  const db = await requireD1();

  for (let attempt = 0; attempt < D1_TX_MAX_RETRIES; attempt++) {
    const row = await readSparksRow(db, wallet);
    const state = normalizeSparkState(
      sparksRowToState(row) ?? defaultSparkState(),
      now
    );

    if (state.infiniteUntil && state.infiniteUntil > now) {
      if (!row) await writeSparksState(db, wallet, state);
      return {
        state,
        sparks: computeSparkSnapshot(state),
        spent: false,
      };
    }

    const readyIndex = findReadySparkSlotIndex(state.slots, now);
    if (readyIndex === -1) {
      throw new SparkSpendError("No Sparks available.", "NO_SPARKS");
    }

    const slots = [...state.slots];
    slots[readyIndex] = now + state.regenMs;
    const next: StoredSparkState = { ...state, slots };
    const packed = sparkStateForD1(next);

    if (!row) {
      await writeSparksState(db, wallet, next);
      return {
        state: next,
        sparks: computeSparkSnapshot(next),
        spent: true,
      };
    }

    const update = await db
      .prepare(
        `UPDATE sparks SET slots_json = ?, infinite_until = ?, max = ?, regen_ms = ?
         WHERE wallet = ? AND slots_json = ?`
      )
      .bind(
        packed.slots_json,
        packed.infinite_until,
        packed.max,
        packed.regen_ms,
        wallet,
        row.slots_json
      )
      .run();

    if (update.meta?.changes === 1) {
      return {
        state: next,
        sparks: computeSparkSnapshot(next),
        spent: true,
      };
    }
  }

  throw new Error("D1 spark spend failed after max retries.");
}

export async function activateInfiniteSparkOnServer(
  walletAddress: string,
  txHash: string
): Promise<{
  state: StoredSparkState;
  sparks: ReturnType<typeof computeSparkSnapshot>;
  activated: boolean;
}> {
  if (!isWalletAddress(walletAddress)) {
    throw new InfiniteSparkActivationError(
      "A valid wallet address is required.",
      "NO_WALLET"
    );
  }

  const wallet = normalizeWalletAddress(walletAddress);
  const normalizedTxHash = txHash.trim().toLowerCase();

  if (!/^0x[a-f0-9]{64}$/.test(normalizedTxHash)) {
    throw new InfiniteSparkActivationError(
      "A valid transaction hash is required.",
      "INVALID_TX"
    );
  }

  const existingPayment = await readGuardWallet(
    normalizedTxHash,
    "spark_payment"
  );
  if (existingPayment) {
    if (existingPayment.wallet !== wallet) {
      throw new InfiniteSparkActivationError(
        "This payment was already used by another wallet.",
        "TX_ALREADY_USED"
      );
    }
    const state = normalizeSparkState(await ensureSparkStateOnServer(wallet));
    return {
      state,
      sparks: computeSparkSnapshot(state),
      activated: false,
    };
  }

  await verifyInfiniteSparkPaymentTx(wallet, normalizedTxHash as Hash);

  const now = Date.now();
  const state = normalizeSparkState(await ensureSparkStateOnServer(wallet), now);
  const baseUntil =
    state.infiniteUntil && state.infiniteUntil > now ? state.infiniteUntil : now;
  const infiniteUntil = baseUntil + INFINITE_SPARK_DURATION_MS;

  const claim = await claimGuardRecord(
    normalizedTxHash,
    "spark_payment",
    wallet,
    () => ({
      wallet,
      activatedAt: now,
      infiniteUntil,
    })
  );

  if (claim.status === "conflict_other_wallet") {
    throw new InfiniteSparkActivationError(
      "This payment was already used by another wallet.",
      "TX_ALREADY_USED"
    );
  }

  if (claim.status === "exists") {
    const current = normalizeSparkState(await ensureSparkStateOnServer(wallet));
    return {
      state: current,
      sparks: computeSparkSnapshot(current),
      activated: false,
    };
  }

  const nextState: StoredSparkState = { ...state, infiniteUntil };
  const db = await requireD1();
  try {
    await writeSparksState(db, wallet, nextState);
  } catch (err) {
    await deleteGuard(normalizedTxHash, "spark_payment").catch(() => {});
    throw err;
  }

  return {
    state: nextState,
    sparks: computeSparkSnapshot(nextState),
    activated: true,
  };
}

export async function activateSparkRefillOnServer(
  walletAddress: string,
  txHash: string
): Promise<{
  state: StoredSparkState;
  sparks: ReturnType<typeof computeSparkSnapshot>;
  refilled: boolean;
}> {
  if (!isWalletAddress(walletAddress)) {
    throw new SparkRefillActivationError(
      "A valid wallet address is required.",
      "NO_WALLET"
    );
  }

  const wallet = normalizeWalletAddress(walletAddress);
  const normalizedTxHash = txHash.trim().toLowerCase();

  if (!/^0x[a-f0-9]{64}$/.test(normalizedTxHash)) {
    throw new SparkRefillActivationError(
      "A valid transaction hash is required.",
      "INVALID_TX"
    );
  }

  const existingPayment = await readGuardWallet(
    normalizedTxHash,
    "spark_payment"
  );
  if (existingPayment) {
    if (existingPayment.wallet !== wallet) {
      throw new SparkRefillActivationError(
        "This payment was already used by another wallet.",
        "TX_ALREADY_USED"
      );
    }
    const state = normalizeSparkState(await ensureSparkStateOnServer(wallet));
    return {
      state,
      sparks: computeSparkSnapshot(state),
      refilled: false,
    };
  }

  await verifySparkRefillPaymentTx(wallet, normalizedTxHash as Hash);

  const now = Date.now();
  const state = normalizeSparkState(await ensureSparkStateOnServer(wallet), now);

  const claim = await claimGuardRecord(
    normalizedTxHash,
    "spark_payment",
    wallet,
    () => ({
      wallet,
      type: "refill",
      activatedAt: now,
    })
  );

  if (claim.status === "conflict_other_wallet") {
    throw new SparkRefillActivationError(
      "This payment was already used by another wallet.",
      "TX_ALREADY_USED"
    );
  }

  if (claim.status === "exists") {
    const current = normalizeSparkState(await ensureSparkStateOnServer(wallet));
    return {
      state: current,
      sparks: computeSparkSnapshot(current),
      refilled: false,
    };
  }

  const nextState: StoredSparkState = {
    ...state,
    slots: Array.from({ length: state.max }, () => null),
  };

  const db = await requireD1();
  try {
    await writeSparksState(db, wallet, nextState);
  } catch (err) {
    await deleteGuard(normalizedTxHash, "spark_payment").catch(() => {});
    throw err;
  }

  return {
    state: nextState,
    sparks: computeSparkSnapshot(nextState),
    refilled: true,
  };
}

// ─── Streak check-in + off-chain rewards ───────────────────────────────────────

export async function recordCheckInTxOnServer(
  walletAddress: string,
  txHash: string,
  day: number,
  campaignId: number
): Promise<{ reused: boolean }> {
  if (!isWalletAddress(walletAddress)) {
    throw new StreakSyncError("A valid wallet address is required.", "NO_WALLET");
  }

  const wallet = normalizeWalletAddress(walletAddress);
  const normalizedTxHash = txHash.trim().toLowerCase();

  if (!/^0x[a-f0-9]{64}$/.test(normalizedTxHash)) {
    throw new StreakSyncError("A valid transaction hash is required.", "INVALID_TX");
  }

  const claim = await claimGuardRecord(
    normalizedTxHash,
    "check_in_tx",
    wallet,
    () => ({
      wallet,
      campaignId,
      day,
      syncedAt: Date.now(),
    })
  );

  if (claim.status === "conflict_other_wallet") {
    throw new StreakSyncError(
      "This check-in was already used by another wallet.",
      "TX_ALREADY_USED"
    );
  }

  return { reused: claim.status === "exists" };
}

export async function grantStreakInfiniteSparkOnServer(
  walletAddress: string,
  txHash: string,
  campaignId: number
): Promise<{
  state: StoredSparkState;
  sparks: ReturnType<typeof computeSparkSnapshot>;
  granted: boolean;
}> {
  if (!isWalletAddress(walletAddress)) {
    throw new StreakRewardError(
      "A valid wallet address is required.",
      "NO_WALLET"
    );
  }

  const wallet = normalizeWalletAddress(walletAddress);
  const normalizedTxHash = txHash.trim().toLowerCase();

  if (!/^0x[a-f0-9]{64}$/.test(normalizedTxHash)) {
    throw new StreakRewardError(
      "A valid transaction hash is required.",
      "INVALID_TX"
    );
  }

  const existingGrant = await readGuardWallet(normalizedTxHash, "streak_grant");
  if (existingGrant) {
    if (existingGrant.wallet !== wallet) {
      throw new StreakRewardError(
        "This reward was already used by another wallet.",
        "TX_ALREADY_USED"
      );
    }
    const state = normalizeSparkState(await ensureSparkStateOnServer(wallet));
    return {
      state,
      sparks: computeSparkSnapshot(state),
      granted: false,
    };
  }

  const { verifyOffchainMilestoneTx } = await import(
    "@/lib/arcadex-rewards-verify"
  );

  try {
    await verifyOffchainMilestoneTx(
      wallet,
      normalizedTxHash as Hash,
      campaignId
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Invalid milestone transaction.";
    throw new StreakRewardError(message, "NO_MILESTONE");
  }

  await recordCheckInTxOnServer(wallet, normalizedTxHash, 0, campaignId);

  const now = Date.now();
  const state = normalizeSparkState(await ensureSparkStateOnServer(wallet), now);
  const baseUntil =
    state.infiniteUntil && state.infiniteUntil > now ? state.infiniteUntil : now;
  const infiniteUntil = baseUntil + INFINITE_SPARK_DURATION_MS;

  const claim = await claimGuardRecord(
    normalizedTxHash,
    "streak_grant",
    wallet,
    () => ({
      wallet,
      campaignId,
      grantedAt: now,
      infiniteUntil,
      reward: "INFINITE_SPARK_24H",
    })
  );

  if (claim.status === "conflict_other_wallet") {
    throw new StreakRewardError(
      "This reward was already used by another wallet.",
      "TX_ALREADY_USED"
    );
  }

  if (claim.status === "exists") {
    const current = normalizeSparkState(await ensureSparkStateOnServer(wallet));
    return {
      state: current,
      sparks: computeSparkSnapshot(current),
      granted: false,
    };
  }

  const nextState: StoredSparkState = { ...state, infiniteUntil };
  const db = await requireD1();
  try {
    await writeSparksState(db, wallet, nextState);
  } catch (err) {
    await deleteGuard(normalizedTxHash, "streak_grant").catch(() => {});
    throw err;
  }

  return {
    state: nextState,
    sparks: computeSparkSnapshot(nextState),
    granted: true,
  };
}

// ─── Game play counts ──────────────────────────────────────────────────────────

async function readAllPlayCounts(): Promise<Record<string, number>> {
  const db = await requireD1();
  const { results } = await db
    .prepare(`SELECT game_id, plays FROM game_plays`)
    .all<{ game_id: string; plays: number }>();

  const counts: Record<string, number> = {};
  for (const row of results ?? []) {
    if (typeof row.plays === "number" && Number.isFinite(row.plays)) {
      counts[row.game_id] = row.plays;
    }
  }
  return counts;
}

export async function fetchGamePlayCountsForIds(
  gameIds: string[]
): Promise<Record<string, number>> {
  const unique = [...new Set(gameIds.filter(Boolean))];
  if (unique.length === 0) return {};

  const cached = getCachedPlayCounts();
  if (cached && unique.every((id) => typeof cached[id] === "number")) {
    return Object.fromEntries(unique.map((id) => [id, cached[id]]));
  }

  if (cached) {
    await invalidateSharedPlayCountsCache();
  }

  const all = await loadPlayCountsWithSharedCache(readAllPlayCounts);
  return Object.fromEntries(
    unique.map((id) => [id, typeof all[id] === "number" ? all[id] : 0])
  );
}

/** @deprecated Prefer fetchGamePlayCountsForIds(catalogIds). */
export async function fetchAllGamePlayCounts(): Promise<Record<string, number>> {
  return loadPlayCountsWithSharedCache(readAllPlayCounts);
}

export async function fetchGamePlayCount(gameId: string): Promise<number> {
  const cached = getCachedPlayCounts();
  if (cached && typeof cached[gameId] === "number") {
    return cached[gameId];
  }

  const db = await requireD1();
  const row = await db
    .prepare(`SELECT plays FROM game_plays WHERE game_id = ?`)
    .bind(gameId)
    .first<{ plays: number }>();
  const value = typeof row?.plays === "number" ? row.plays : 0;
  mergeCachedPlayCounts({ [gameId]: value });
  return value;
}

export async function incrementGamePlayCount(gameId: string): Promise<number> {
  const db = await requireD1();
  await db
    .prepare(
      `INSERT INTO game_plays (game_id, plays) VALUES (?, 1)
       ON CONFLICT(game_id) DO UPDATE SET plays = plays + 1`
    )
    .bind(gameId)
    .run();

  const bumped = bumpCachedPlayCount(gameId, 1);
  void invalidateSharedPlayCountsKv().catch(() => {});

  if (typeof bumped === "number") return bumped;
  return fetchGamePlayCount(gameId);
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────

export async function fetchLeaderboardFromServer(
  gameId: string,
  limit = LEADERBOARD_MAX_ENTRIES
): Promise<LeaderboardEntry[]> {
  const db = await requireD1();
  const { results } = await db
    .prepare(
      `SELECT game_id, player_key, name, score, wallet, created_at
       FROM leaderboard_entries
       WHERE game_id = ?
       ORDER BY score DESC
       LIMIT ?`
    )
    .bind(gameId, Math.max(limit * 3, limit))
    .all<LeaderboardRow>();

  const best = new Map<string, LeaderboardEntry>();
  for (const row of results ?? []) {
    const entry = rowToLeaderboardEntry(row);
    const key = leaderboardUserKey(entry);
    const current = best.get(key);
    if (!current || entry.score > current.score) {
      best.set(key, entry);
    }
  }

  return Array.from(best.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function fetchUserSubmittedScoreFromServer(
  gameId: string,
  opts: { walletAddress?: string; playerName?: string }
): Promise<number> {
  const wallet = tryNormalizeWalletAddress(opts.walletAddress);
  const name = opts.playerName?.trim().toLowerCase();
  if (!wallet && !name) return 0;

  const db = await requireD1();

  if (wallet) {
    const row = await db
      .prepare(
        `SELECT score FROM leaderboard_entries WHERE game_id = ? AND player_key = ?`
      )
      .bind(gameId, wallet)
      .first<{ score: number }>();
    if (row && typeof row.score === "number") return row.score;
  }

  if (name) {
    const key = `name_${name.replace(/[.#$[\]/]/g, "_")}`;
    const row = await db
      .prepare(
        `SELECT score FROM leaderboard_entries WHERE game_id = ? AND player_key = ?`
      )
      .bind(gameId, key)
      .first<{ score: number }>();
    if (row && typeof row.score === "number") return row.score;
  }

  return 0;
}

/** @deprecated Use fetchUserSubmittedScoreFromServer */
export const fetchUserBestScoreFromServer = fetchUserSubmittedScoreFromServer;

export async function fetchPersonalBestFromServer(
  walletAddress: string,
  gameId: string
): Promise<number> {
  if (!isWalletAddress(walletAddress)) return 0;
  const stored = await fetchGameProgressFromServer(walletAddress, gameId);
  return readStoredScore(stored);
}

export async function submitLeaderboardEntryOnServer(
  gameId: string,
  entry: LeaderboardEntry
): Promise<void> {
  const wallet = tryNormalizeWalletAddress(entry.walletAddress);
  const payload: LeaderboardEntry = {
    name: entry.name,
    score: entry.score,
    ...(wallet ? { walletAddress: wallet } : {}),
    createdAt: entry.createdAt ?? Date.now(),
  };

  const storageKey = leaderboardStorageKey(payload);
  const db = await requireD1();
  const existing = await db
    .prepare(
      `SELECT score FROM leaderboard_entries WHERE game_id = ? AND player_key = ?`
    )
    .bind(gameId, storageKey)
    .first<{ score: number }>();

  if (
    existing &&
    typeof existing.score === "number" &&
    existing.score >= payload.score
  ) {
    return;
  }

  await db
    .prepare(
      `INSERT INTO leaderboard_entries (game_id, player_key, name, score, wallet, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(game_id, player_key) DO UPDATE SET
         name = excluded.name,
         score = excluded.score,
         wallet = excluded.wallet,
         created_at = excluded.created_at
       WHERE excluded.score > leaderboard_entries.score`
    )
    .bind(
      gameId,
      storageKey,
      payload.name,
      payload.score,
      wallet ?? null,
      payload.createdAt ?? null
    )
    .run();
}

export async function submitContestLeaderboardEntryOnServer(
  gameId: string,
  contestStartedAt: number,
  entry: LeaderboardEntry
): Promise<void> {
  const wallet = tryNormalizeWalletAddress(entry.walletAddress);
  if (!wallet) return;

  const payload: LeaderboardEntry = {
    name: entry.name,
    score: entry.score,
    walletAddress: wallet,
    createdAt: entry.createdAt ?? Date.now(),
  };

  const db = await requireD1();
  const existing = await db
    .prepare(
      `SELECT score FROM contest_entries
       WHERE game_id = ? AND contest_started_at = ? AND wallet = ?`
    )
    .bind(gameId, contestStartedAt, wallet)
    .first<{ score: number }>();

  if (
    existing &&
    typeof existing.score === "number" &&
    existing.score >= payload.score
  ) {
    return;
  }

  await db
    .prepare(
      `INSERT INTO contest_entries (game_id, contest_started_at, wallet, name, score, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(game_id, contest_started_at, wallet) DO UPDATE SET
         name = excluded.name,
         score = excluded.score,
         created_at = excluded.created_at
       WHERE excluded.score > contest_entries.score`
    )
    .bind(
      gameId,
      contestStartedAt,
      wallet,
      payload.name,
      payload.score,
      payload.createdAt ?? null
    )
    .run();
}

export async function fetchContestLeaderboardFromServer(
  gameId: string,
  contestStartedAt: number,
  limit = CONTEST_MAX_ENTRIES
): Promise<LeaderboardEntry[]> {
  const db = await requireD1();
  const { results } = await db
    .prepare(
      `SELECT game_id, wallet AS player_key, name, score, wallet, created_at
       FROM contest_entries
       WHERE game_id = ? AND contest_started_at = ?
       ORDER BY score DESC
       LIMIT ?`
    )
    .bind(gameId, contestStartedAt, limit)
    .all<LeaderboardRow>();

  return (results ?? []).map(rowToLeaderboardEntry);
}

// ─── Per-user game progress ───────────────────────────────────────────────────

export function readStoredScore(stored: StoredGameProgress | null): number {
  if (!stored) return 0;
  if (typeof stored.s === "number") return stored.s;
  if (typeof stored.score === "number") return stored.score;
  if (typeof stored.highScore === "number") return stored.highScore;
  return 0;
}

export function storedProgressToGameProgress(
  stored: StoredGameProgress | null,
  hasLeaderboard: boolean
): GameProgress {
  if (!stored) return {};
  if (hasLeaderboard) {
    const score = readStoredScore(stored);
    return score > 0 ? { score } : {};
  }
  return stored.l !== undefined ? { level: stored.l } : {};
}

export async function fetchGameProgressFromServer(
  walletAddress: string,
  gameId: string
): Promise<StoredGameProgress | null> {
  if (!isWalletAddress(walletAddress)) return null;
  const wallet = normalizeWalletAddress(walletAddress);
  const db = await requireD1();
  return progressRowToStored(await readProgressRow(db, wallet, gameId));
}

export async function resolveGameProgressFromServer(
  walletAddress: string,
  gameId: string,
  hasLeaderboard: boolean,
  _opts?: { playerName?: string }
): Promise<GameProgress> {
  if (!isWalletAddress(walletAddress)) return {};
  const stored = await fetchGameProgressFromServer(walletAddress, gameId);
  return storedProgressToGameProgress(stored, hasLeaderboard);
}

export async function activateScoreSubmitOnServer(
  walletAddress: string,
  gameId: string,
  txHash: string,
  score: number,
  opts?: { contestStartedAt?: number }
): Promise<{
  highScore: number;
  leaderboardScore: number;
  submitted: boolean;
}> {
  if (!isWalletAddress(walletAddress)) {
    throw new ScoreSubmitActivationError(
      "A valid wallet address is required.",
      "NO_WALLET"
    );
  }

  if (typeof score !== "number" || !Number.isFinite(score) || score <= 0) {
    throw new ScoreSubmitActivationError(
      "A valid score greater than zero is required.",
      "NO_SCORE"
    );
  }

  const wallet = normalizeWalletAddress(walletAddress);
  const normalizedTxHash = txHash.trim().toLowerCase();

  if (!/^0x[a-f0-9]{64}$/.test(normalizedTxHash)) {
    throw new ScoreSubmitActivationError(
      "A valid transaction hash is required.",
      "INVALID_TX"
    );
  }

  const profile = await fetchUserFromServer(wallet);
  const playerName = profile?.name?.trim();
  if (!playerName) {
    throw new ScoreSubmitActivationError(
      "Set your player name before submitting a score.",
      "NO_NAME"
    );
  }

  const highScore = await fetchPersonalBestFromServer(wallet, gameId);
  const existingPayment = await readGuardWallet(
    normalizedTxHash,
    "score_payment"
  );

  if (existingPayment) {
    if (existingPayment.wallet !== wallet) {
      throw new ScoreSubmitActivationError(
        "This payment was already used by another wallet.",
        "TX_ALREADY_USED"
      );
    }
    const leaderboardScore = await fetchUserSubmittedScoreFromServer(gameId, {
      walletAddress: wallet,
      playerName,
    });
    return { highScore, leaderboardScore, submitted: false };
  }

  await verifyScoreSubmitPaymentTx(wallet, normalizedTxHash as Hash);

  const now = Date.now();
  const claim = await claimGuardRecord(
    normalizedTxHash,
    "score_payment",
    wallet,
    () => ({
      wallet,
      gameId,
      score,
      activatedAt: now,
    })
  );

  if (claim.status === "conflict_other_wallet") {
    throw new ScoreSubmitActivationError(
      "This payment was already used by another wallet.",
      "TX_ALREADY_USED"
    );
  }

  if (claim.status === "exists") {
    const leaderboardScore = await fetchUserSubmittedScoreFromServer(gameId, {
      walletAddress: wallet,
      playerName,
    });
    return { highScore, leaderboardScore, submitted: false };
  }

  try {
    await submitLeaderboardEntryOnServer(gameId, {
      name: playerName,
      score,
      walletAddress: wallet,
    });

    if (typeof opts?.contestStartedAt === "number") {
      await submitContestLeaderboardEntryOnServer(
        gameId,
        opts.contestStartedAt,
        {
          name: playerName,
          score,
          walletAddress: wallet,
          createdAt: Date.now(),
        }
      );
    }
  } catch (err) {
    await deleteGuard(normalizedTxHash, "score_payment").catch(() => {});
    throw err;
  }

  const leaderboardScore = await fetchUserSubmittedScoreFromServer(gameId, {
    walletAddress: wallet,
    playerName,
  });

  return { highScore, leaderboardScore, submitted: true };
}

export async function saveGameProgressOnServer(
  walletAddress: string,
  gameId: string,
  value: number,
  hasLeaderboard: boolean,
  _opts?: { playerName?: string }
): Promise<GameProgress> {
  if (!isWalletAddress(walletAddress)) {
    throw new Error("A valid wallet address is required.");
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("value must be a non-negative number.");
  }

  const wallet = normalizeWalletAddress(walletAddress);

  return coalesceProgressWrite(wallet, gameId, value, async (maxValue) => {
    const field: "s" | "l" = hasLeaderboard ? "s" : "l";
    const db = await requireD1();

    for (let attempt = 0; attempt < D1_TX_MAX_RETRIES; attempt++) {
      const current = progressRowToStored(
        await readProgressRow(db, wallet, gameId)
      );
      const currentValue = hasLeaderboard
        ? readStoredScore(current)
        : (current?.l ?? 0);

      if (maxValue <= currentValue) {
        return storedProgressToGameProgress(current, hasLeaderboard);
      }

      const next: StoredGameProgress = {
        ...(current ?? {}),
        [field]: maxValue,
      };
      await upsertProgressRow(db, wallet, gameId, next);
      return storedProgressToGameProgress(next, hasLeaderboard);
    }

    const stored = await fetchGameProgressFromServer(wallet, gameId);
    return storedProgressToGameProgress(stored, hasLeaderboard);
  });
}

const GAME_STATE_MAX_BYTES = 256 * 1024;
const UNSAFE_KEY = /[.$#[\]/]/;

function sanitizeGameStateValue(value: unknown, depth = 0): unknown {
  if (depth > 10) return null;
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.length > 20_000 ? value.slice(0, 20_000) : value;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 1000)
      .map((item) => sanitizeGameStateValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>
    )) {
      if (count >= 200) break;
      if (!key || UNSAFE_KEY.test(key)) continue;
      out[key] = sanitizeGameStateValue(nested, depth + 1);
      count += 1;
    }
    return out;
  }
  return null;
}

function sanitizeGameStateObject(state: unknown): Record<string, unknown> {
  const sanitized = sanitizeGameStateValue(state);
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) {
    throw new Error("Game state must be a JSON object.");
  }
  const json = JSON.stringify(sanitized);
  if (json.length > GAME_STATE_MAX_BYTES) {
    throw new Error("Game state is too large.");
  }
  return sanitized as Record<string, unknown>;
}

function readStoredGameState(
  stored: StoredGameProgress | null
): Record<string, unknown> | null {
  if (!stored?.st || typeof stored.st !== "object" || Array.isArray(stored.st)) {
    return null;
  }
  return stored.st;
}

export async function fetchGameStateFromServer(
  walletAddress: string,
  gameId: string
): Promise<GameStateRecord> {
  if (!isWalletAddress(walletAddress)) {
    return { found: false, revision: 0, state: null };
  }

  const stored = await fetchGameProgressFromServer(walletAddress, gameId);
  const state = readStoredGameState(stored);
  return {
    found: state != null && Object.keys(state).length > 0,
    revision: typeof stored?.r === "number" ? stored.r : 0,
    state,
  };
}

export async function saveGameStateOnServer(
  walletAddress: string,
  gameId: string,
  state: unknown,
  opts?: { baseRevision?: number; merge?: boolean }
): Promise<GameStateRecord> {
  if (!isWalletAddress(walletAddress)) {
    throw new Error("A valid wallet address is required.");
  }

  const incoming = sanitizeGameStateObject(state);
  const wallet = normalizeWalletAddress(walletAddress);
  const db = await requireD1();

  for (let attempt = 0; attempt < D1_TX_MAX_RETRIES; attempt++) {
    const row = await readProgressRow(db, wallet, gameId);
    const current = progressRowToStored(row);
    const currentRevision = typeof current?.r === "number" ? current.r : 0;

    if (
      typeof opts?.baseRevision === "number" &&
      opts.baseRevision > 0 &&
      currentRevision > 0 &&
      opts.baseRevision !== currentRevision
    ) {
      throw new GameStateConflictError(
        currentRevision,
        readStoredGameState(current)
      );
    }

    const currentState = readStoredGameState(current) ?? {};
    const nextState = opts?.merge
      ? { ...currentState, ...incoming }
      : incoming;
    const next: StoredGameProgress = {
      ...(current ?? {}),
      st: nextState,
      r: currentRevision + 1,
    };

    if (row) {
      const update = await db
        .prepare(
          `UPDATE game_progress
           SET st_json = ?, r = ?, s = ?, l = ?
           WHERE wallet = ? AND game_id = ? AND IFNULL(r, 0) = ?`
        )
        .bind(
          JSON.stringify(nextState),
          next.r ?? null,
          typeof next.s === "number" ? next.s : null,
          typeof next.l === "number" ? next.l : null,
          wallet,
          gameId,
          currentRevision
        )
        .run();

      if (update.meta?.changes !== 1) continue;
    } else {
      await upsertProgressRow(db, wallet, gameId, next);
    }

    return {
      found: true,
      revision: typeof next.r === "number" ? next.r : 1,
      state: nextState,
    };
  }

  const latest = await fetchGameStateFromServer(wallet, gameId);
  throw new GameStateConflictError(latest.revision, latest.state);
}

// --- Daily shuffle -------------------------------------------------------------

export async function getShuffleUsdtBudgetRemainingMicro(
  nowMs: number = Date.now()
): Promise<number> {
  const dayKey = shuffleUtcDayKey(nowMs);
  const db = await requireD1();
  const row = await db
    .prepare(
      `SELECT day_key, spent_micro, reservations_json, confirmed_json
       FROM shuffle_daily_budget WHERE day_key = ?`
    )
    .bind(dayKey)
    .first<BudgetRow>();
  const data = parseBudgetRow(row);
  const reservations = pruneExpiredReservations(data.reservations, nowMs);
  const spent = typeof data.spentMicro === "number" ? data.spentMicro : 0;
  const reserved = sumReservedMicro(reservations);
  return Math.max(0, SHUFFLE_DAILY_USDT_BUDGET_MICRO - spent - reserved);
}

export async function reserveShuffleUsdtBudget(opts: {
  amountMicro: number;
  reservationKey: string;
  expiresAtMs: number;
  nowMs?: number;
}): Promise<{ ok: true; remainingMicro: number } | { ok: false; remainingMicro: number }> {
  const nowMs = opts.nowMs ?? Date.now();
  const dayKey = shuffleUtcDayKey(nowMs);
  const db = await requireD1();

  for (let attempt = 0; attempt < D1_TX_MAX_RETRIES; attempt++) {
    const row = await db
      .prepare(
        `SELECT day_key, spent_micro, reservations_json, confirmed_json
         FROM shuffle_daily_budget WHERE day_key = ?`
      )
      .bind(dayKey)
      .first<BudgetRow>();

    const current = parseBudgetRow(row);
    const reservations = pruneExpiredReservations(current.reservations, nowMs);
    const confirmed = current.confirmed ?? {};
    const spent =
      typeof current.spentMicro === "number" ? current.spentMicro : 0;
    const existing = reservations[opts.reservationKey];

    if (existing && existing.amountMicro === opts.amountMicro) {
      reservations[opts.reservationKey] = {
        amountMicro: opts.amountMicro,
        expiresAt: opts.expiresAtMs,
      };
      await writeBudgetRow(db, dayKey, {
        spentMicro: spent,
        reservations,
        confirmed,
      });
      return {
        ok: true,
        remainingMicro: Math.max(
          0,
          SHUFFLE_DAILY_USDT_BUDGET_MICRO - spent - sumReservedMicro(reservations)
        ),
      };
    }

    if (existing) {
      delete reservations[opts.reservationKey];
    }

    const reserved = sumReservedMicro(reservations);
    let remainingMicro = Math.max(
      0,
      SHUFFLE_DAILY_USDT_BUDGET_MICRO - spent - reserved
    );
    if (opts.amountMicro > remainingMicro) {
      return { ok: false, remainingMicro };
    }

    reservations[opts.reservationKey] = {
      amountMicro: opts.amountMicro,
      expiresAt: opts.expiresAtMs,
    };
    remainingMicro -= opts.amountMicro;

    await writeBudgetRow(db, dayKey, {
      spentMicro: spent,
      reservations,
      confirmed,
    });
    return { ok: true, remainingMicro };
  }

  return {
    ok: false,
    remainingMicro: await getShuffleUsdtBudgetRemainingMicro(nowMs),
  };
}

export async function confirmShuffleUsdtBudget(opts: {
  amountMicro: number;
  reservationKey: string;
  nowMs?: number;
}): Promise<void> {
  const nowMs = opts.nowMs ?? Date.now();
  const dayKey = shuffleUtcDayKey(nowMs);
  const db = await requireD1();

  for (let attempt = 0; attempt < D1_TX_MAX_RETRIES; attempt++) {
    const row = await db
      .prepare(
        `SELECT day_key, spent_micro, reservations_json, confirmed_json
         FROM shuffle_daily_budget WHERE day_key = ?`
      )
      .bind(dayKey)
      .first<BudgetRow>();

    const current = parseBudgetRow(row);
    const reservations = pruneExpiredReservations(current.reservations, nowMs);
    const confirmed = { ...(current.confirmed ?? {}) };
    const spent =
      typeof current.spentMicro === "number" ? current.spentMicro : 0;

    if (typeof confirmed[opts.reservationKey] === "number") {
      delete reservations[opts.reservationKey];
      await writeBudgetRow(db, dayKey, {
        spentMicro: spent,
        reservations,
        confirmed,
      });
      return;
    }

    const existing = reservations[opts.reservationKey];
    delete reservations[opts.reservationKey];
    const addMicro = existing?.amountMicro ?? opts.amountMicro;
    confirmed[opts.reservationKey] = addMicro;

    await writeBudgetRow(db, dayKey, {
      spentMicro: spent + addMicro,
      reservations,
      confirmed,
    });
    return;
  }
}

export async function saveShufflePending(
  record: ShufflePendingRecord
): Promise<void> {
  const db = await requireD1();
  const wallet = normalizeWalletAddress(record.wallet);
  await db
    .prepare(
      `INSERT INTO shuffle_pending (wallet, campaign_id, nonce, payload_json, consumed_at, tx_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(wallet, campaign_id, nonce) DO UPDATE SET
         payload_json = excluded.payload_json,
         consumed_at = excluded.consumed_at,
         tx_hash = excluded.tx_hash,
         created_at = excluded.created_at`
    )
    .bind(
      wallet,
      String(record.campaignId),
      String(record.nonce),
      JSON.stringify({ ...record, wallet }),
      record.consumedAt ?? null,
      record.txHash ?? null,
      record.createdAt
    )
    .run();
}

export async function getShufflePending(
  walletAddress: string,
  campaignId: number,
  nonce: number
): Promise<ShufflePendingRecord | null> {
  const wallet = normalizeWalletAddress(walletAddress);
  const db = await requireD1();
  const row = await db
    .prepare(
      `SELECT payload_json, consumed_at, tx_hash FROM shuffle_pending
       WHERE wallet = ? AND campaign_id = ? AND nonce = ?`
    )
    .bind(wallet, String(campaignId), String(nonce))
    .first<{
      payload_json: string;
      consumed_at: number | null;
      tx_hash: string | null;
    }>();

  if (!row?.payload_json) return null;
  try {
    const parsed = JSON.parse(row.payload_json) as ShufflePendingRecord;
    return {
      ...parsed,
      wallet,
      ...(typeof row.consumed_at === "number"
        ? { consumedAt: row.consumed_at }
        : {}),
      ...(row.tx_hash ? { txHash: row.tx_hash } : {}),
    };
  } catch {
    return null;
  }
}

export async function recordDeviceSeenIfAbsent(
  walletAddress: string,
  deviceHash: string
): Promise<number> {
  const wallet = normalizeWalletAddress(walletAddress);
  const now = Date.now();
  const db = await requireD1();

  const insert = await db
    .prepare(
      `INSERT OR IGNORE INTO device_seen (wallet, device_hash, first_seen_at)
       VALUES (?, ?, ?)`
    )
    .bind(wallet, deviceHash, now)
    .run();

  if (insert.meta?.changes === 1) return now;

  const row = await db
    .prepare(
      `SELECT first_seen_at FROM device_seen WHERE wallet = ? AND device_hash = ?`
    )
    .bind(wallet, deviceHash)
    .first<{ first_seen_at: number }>();

  return typeof row?.first_seen_at === "number" && row.first_seen_at > 0
    ? row.first_seen_at
    : now;
}

export async function getDeviceSeenAt(
  walletAddress: string,
  deviceHash: string
): Promise<number | null> {
  const wallet = normalizeWalletAddress(walletAddress);
  const db = await requireD1();
  const row = await db
    .prepare(
      `SELECT first_seen_at FROM device_seen WHERE wallet = ? AND device_hash = ?`
    )
    .bind(wallet, deviceHash)
    .first<{ first_seen_at: number }>();
  return typeof row?.first_seen_at === "number" && row.first_seen_at > 0
    ? row.first_seen_at
    : null;
}

export async function bindWalletSessionDevice(
  walletAddress: string,
  deviceHash: string
): Promise<void> {
  const wallet = normalizeWalletAddress(walletAddress);
  const db = await requireD1();
  await db
    .prepare(
      `INSERT INTO session_device (wallet, hash, bound_at)
       VALUES (?, ?, ?)
       ON CONFLICT(wallet) DO UPDATE SET
         hash = excluded.hash,
         bound_at = excluded.bound_at`
    )
    .bind(wallet, deviceHash, Date.now())
    .run();
}

export async function getWalletSessionDeviceHash(
  walletAddress: string
): Promise<string | null> {
  const wallet = normalizeWalletAddress(walletAddress);
  const db = await requireD1();
  const row = await db
    .prepare(`SELECT hash FROM session_device WHERE wallet = ?`)
    .bind(wallet)
    .first<{ hash: string }>();
  return typeof row?.hash === "string" && row.hash.length > 0 ? row.hash : null;
}

export async function bindShufflePendingDevice(
  walletAddress: string,
  campaignId: number,
  nonce: number,
  deviceHash: string
): Promise<void> {
  const existing = await getShufflePending(walletAddress, campaignId, nonce);
  if (!existing) return;
  await saveShufflePending({ ...existing, deviceHash });
}

export async function markShufflePendingConsumed(
  walletAddress: string,
  campaignId: number,
  nonce: number,
  txHash: string
): Promise<void> {
  const wallet = normalizeWalletAddress(walletAddress);
  const existing = await getShufflePending(wallet, campaignId, nonce);
  if (!existing) return;

  const consumedAt = Date.now();
  const normalizedTx = txHash.toLowerCase();
  const db = await requireD1();
  await db
    .prepare(
      `UPDATE shuffle_pending
       SET consumed_at = ?, tx_hash = ?, payload_json = ?
       WHERE wallet = ? AND campaign_id = ? AND nonce = ?`
    )
    .bind(
      consumedAt,
      normalizedTx,
      JSON.stringify({
        ...existing,
        consumedAt,
        txHash: normalizedTx,
      }),
      wallet,
      String(campaignId),
      String(nonce)
    )
    .run();
}

export async function recordSpinTxOnServer(
  walletAddress: string,
  txHash: string,
  campaignId: number,
  outcomeId: string
): Promise<{ reused: boolean }> {
  if (!isWalletAddress(walletAddress)) {
    throw new StreakSyncError("A valid wallet address is required.", "NO_WALLET");
  }

  const wallet = normalizeWalletAddress(walletAddress);
  const normalizedTxHash = txHash.trim().toLowerCase();

  if (!/^0x[a-f0-9]{64}$/.test(normalizedTxHash)) {
    throw new StreakSyncError("A valid transaction hash is required.", "INVALID_TX");
  }

  const claim = await claimGuardRecord(
    normalizedTxHash,
    "spin_tx",
    wallet,
    () => ({
      wallet,
      campaignId,
      outcomeId,
      syncedAt: Date.now(),
    })
  );

  if (claim.status === "conflict_other_wallet") {
    throw new StreakSyncError(
      "This spin was already used by another wallet.",
      "TX_ALREADY_USED"
    );
  }

  return { reused: claim.status === "exists" };
}

export async function grantShuffleInfiniteSparkOnServer(
  walletAddress: string,
  txHash: string
): Promise<{
  state: StoredSparkState;
  sparks: ReturnType<typeof computeSparkSnapshot>;
  granted: boolean;
}> {
  if (!isWalletAddress(walletAddress)) {
    throw new StreakRewardError(
      "A valid wallet address is required.",
      "NO_WALLET"
    );
  }

  const wallet = normalizeWalletAddress(walletAddress);
  const normalizedTxHash = txHash.trim().toLowerCase();
  const existingGrant = await readGuardWallet(
    normalizedTxHash,
    "shuffle_grant"
  );

  if (existingGrant) {
    if (existingGrant.wallet !== wallet) {
      throw new StreakRewardError(
        "This reward was already used by another wallet.",
        "TX_ALREADY_USED"
      );
    }
    const state = normalizeSparkState(await ensureSparkStateOnServer(wallet));
    return {
      state,
      sparks: computeSparkSnapshot(state),
      granted: false,
    };
  }

  const now = Date.now();
  const state = normalizeSparkState(await ensureSparkStateOnServer(wallet), now);
  const baseUntil =
    state.infiniteUntil && state.infiniteUntil > now ? state.infiniteUntil : now;
  const infiniteUntil = baseUntil + INFINITE_SPARK_DURATION_MS;

  const claim = await claimGuardRecord(
    normalizedTxHash,
    "shuffle_grant",
    wallet,
    () => ({
      wallet,
      grantedAt: now,
      infiniteUntil,
      reward: "INFINITE_SPARK_24H",
      source: "shuffle",
    })
  );

  if (claim.status === "conflict_other_wallet") {
    throw new StreakRewardError(
      "This reward was already used by another wallet.",
      "TX_ALREADY_USED"
    );
  }

  if (claim.status === "exists") {
    const current = normalizeSparkState(await ensureSparkStateOnServer(wallet));
    return {
      state: current,
      sparks: computeSparkSnapshot(current),
      granted: false,
    };
  }

  const nextState: StoredSparkState = { ...state, infiniteUntil };
  const db = await requireD1();
  try {
    await writeSparksState(db, wallet, nextState);
  } catch (err) {
    await deleteGuard(normalizedTxHash, "shuffle_grant").catch(() => {});
    throw err;
  }

  return {
    state: nextState,
    sparks: computeSparkSnapshot(nextState),
    granted: true,
  };
}
