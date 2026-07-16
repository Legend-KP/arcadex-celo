import {
  GameProgress,
  GameGatingFlags,
  LEADERBOARD_MAX_ENTRIES,
  CONTEST_MAX_ENTRIES,
  LeaderboardEntry,
  PlayerProfile,
  StoredGameProgress,
  StoredSparkState,
} from "@/types";
import {
  computeSparkSnapshot,
  coerceSparkState,
  defaultSparkState,
  findReadySparkSlotIndex,
  normalizeSparkState,
  sparkStateForRtdb,
} from "@/lib/spark";
import { INFINITE_SPARK_DURATION_MS } from "@/lib/infinite-spark";
import {
  verifyInfiniteSparkPaymentTx,
} from "@/lib/infinite-spark-verify";
import { verifySparkRefillPaymentTx } from "@/lib/spark-refill-verify";
import { verifyScoreSubmitPaymentTx } from "@/lib/score-submit-verify";
import type { Hash } from "viem";
import { getDatabaseUrl } from "./firebase-admin";
import {
  bumpCachedPlayCount,
  getCachedGameFlags,
  getCachedPlayCounts,
  invalidateGameFlagsCache,
  setCachedGameFlags,
  setCachedPlayCounts,
} from "@/lib/rtdb-cache";
import { coalesceProgressWrite } from "@/lib/progress-write-coalesce";
import {
  isWalletAddress,
  normalizeWalletAddress,
  tryNormalizeWalletAddress,
} from "@/lib/wallet-address";

type StoredUser = Omit<PlayerProfile, "id">;
type LeaderboardMap = Record<string, LeaderboardEntry>;

/** Extra slots in the top mirror so a near-miss doesn't thrash the cut line. */
const LEADERBOARD_TOP_MIRROR_SIZE = 50;
const CONTEST_TOP_MIRROR_SIZE = 15;
const RTDB_TRANSACTION_MAX_RETRIES = 8;

function getRtdbAuthQuery(): string {
  const secret = process.env.FIREBASE_DATABASE_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "FIREBASE_DATABASE_SECRET is missing. Add it to Cloudflare Worker secrets (Firebase Console → Realtime Database → Secrets)."
    );
  }
  return `auth=${encodeURIComponent(secret)}`;
}

/** Encode each path segment for RTDB REST (wallet keys, game ids, etc.). */
function encodeRtdbPath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function profilePath(walletAddress: string): string {
  if (!isWalletAddress(walletAddress)) {
    throw new Error("User profile requires a valid wallet address.");
  }
  return `users/${normalizeWalletAddress(walletAddress)}`;
}

function sparksPath(walletAddress: string): string {
  return `${profilePath(walletAddress)}/sparks`;
}

function resolveWalletField(
  id: string,
  walletAddress?: string
): string | undefined {
  const fromBody = tryNormalizeWalletAddress(walletAddress);
  if (fromBody) return fromBody;
  if (isWalletAddress(id)) return normalizeWalletAddress(id);
  return undefined;
}

async function rtdbFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const auth = getRtdbAuthQuery();
  const url = `${getDatabaseUrl()}/${encodeRtdbPath(path)}.json?${auth}`;

  return fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });
}

async function readPath<T>(path: string): Promise<T | null> {
  const res = await rtdbFetch(path);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Realtime Database read failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as T | null;
  return data ?? null;
}

/** GET with ETag for conditional writes (REST transactions). */
async function readPathWithEtag<T>(
  path: string
): Promise<{ data: T | null; etag: string }> {
  const res = await rtdbFetch(path, {
    headers: { "X-Firebase-ETag": "true" },
  });
  if (res.status === 404) {
    return { data: null, etag: res.headers.get("ETag") ?? '""' };
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Realtime Database read failed (${res.status}): ${text}`);
  }

  const etag = res.headers.get("ETag");
  if (!etag) {
    throw new Error("Realtime Database ETag missing for transaction read.");
  }

  const data = (await res.json()) as T | null;
  return { data: data ?? null, etag };
}

async function writePath(path: string, data: unknown): Promise<void> {
  const res = await rtdbFetch(path, {
    method: "PUT",
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Realtime Database write failed (${res.status}): ${text}`);
  }
}

async function writePathIfMatch(
  path: string,
  data: unknown,
  etag: string
): Promise<"ok" | "conflict"> {
  const res = await rtdbFetch(path, {
    method: "PUT",
    headers: { "if-match": etag },
    body: JSON.stringify(data),
  });

  if (res.status === 412) return "conflict";
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Realtime Database write failed (${res.status}): ${text}`);
  }
  return "ok";
}

async function patchPath(path: string, data: unknown): Promise<void> {
  const res = await rtdbFetch(path, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Realtime Database patch failed (${res.status}): ${text}`);
  }
}

/** Atomic ServerValue.increment — no read-before-write race. */
async function incrementPath(path: string, delta = 1): Promise<void> {
  const res = await rtdbFetch(path, {
    method: "PUT",
    body: JSON.stringify({ ".sv": { increment: delta } }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Realtime Database increment failed (${res.status}): ${text}`
    );
  }
}

/**
 * Conditional write with automatic retry (RTDB REST transaction via ETag).
 * Return `undefined` from `updateFn` to abort without writing.
 */
async function runRtdbTransaction<T>(
  path: string,
  updateFn: (current: T | null) => T | undefined,
  maxRetries = RTDB_TRANSACTION_MAX_RETRIES
): Promise<{ committed: boolean; snapshot: T | null }> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { data, etag } = await readPathWithEtag<T>(path);
    const next = updateFn(data);
    if (next === undefined) {
      return { committed: false, snapshot: data };
    }

    const result = await writePathIfMatch(path, next, etag);
    if (result === "ok") {
      return { committed: true, snapshot: next };
    }
  }

  throw new Error("Realtime Database transaction failed after max retries.");
}

function toPlayerProfile(id: string, data: StoredUser | null): PlayerProfile | null {
  if (!data) return null;
  return { id, ...data };
}

function mapToLeaderboardEntries(map: LeaderboardMap | null): LeaderboardEntry[] {
  if (!map) return [];
  const entries: LeaderboardEntry[] = [];
  for (const [key, value] of Object.entries(map)) {
    // Skip nested mirror/history containers if a parent node was read.
    if (key === "top" || key === "entries") continue;
    if (!value || typeof value !== "object") continue;
    if (typeof (value as LeaderboardEntry).score !== "number") continue;
    if (typeof (value as LeaderboardEntry).name !== "string") continue;
    entries.push(value as LeaderboardEntry);
  }
  return entries;
}

/** Stable identity for deduping — wallet preferred, name fallback. */
function leaderboardUserKey(entry: LeaderboardEntry): string {
  const wallet = tryNormalizeWalletAddress(entry.walletAddress);
  if (wallet) return `wallet:${wallet}`;
  return `name:${entry.name.trim().toLowerCase()}`;
}

/** RTDB-safe key for per-user storage (wallet or sanitized name). */
function leaderboardStorageKey(entry: LeaderboardEntry): string {
  const wallet = tryNormalizeWalletAddress(entry.walletAddress);
  if (wallet) return wallet;
  return `name_${entry.name.trim().toLowerCase().replace(/[.#$[\]/]/g, "_")}`;
}

function deduplicateLeaderboardEntries(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  const best = new Map<string, LeaderboardEntry>();
  for (const entry of entries) {
    const key = leaderboardUserKey(entry);
    const current = best.get(key);
    if (!current || entry.score > current.score) {
      best.set(key, entry);
    }
  }
  return Array.from(best.values());
}

// ─── Users ───────────────────────────────────────────────────────────────────

export async function fetchUserFromServer(
  id: string
): Promise<PlayerProfile | null> {
  const wallet = tryNormalizeWalletAddress(id);
  if (!wallet) return null;

  const data = await readPath<StoredUser>(profilePath(wallet));
  if (!data) return null;
  return toPlayerProfile(wallet, data);
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

  await writePath(profilePath(wallet), stored);
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
    await writePath(`users/${wallet}`, stored);
    await writePath(sparksPath(wallet), sparkStateForRtdb(defaultSparkState()));
    return toPlayerProfile(wallet, stored)!;
  }

  await ensureSparkStateOnServer(wallet);
  return existing;
}

// ─── Sparks ───────────────────────────────────────────────────────────────────

export async function fetchSparkStateFromServer(
  walletAddress: string
): Promise<StoredSparkState> {
  if (!isWalletAddress(walletAddress)) {
    throw new Error("A valid wallet address is required.");
  }

  return ensureSparkStateOnServer(walletAddress);
}

export async function ensureSparkStateOnServer(
  walletAddress: string
): Promise<StoredSparkState> {
  const wallet = normalizeWalletAddress(walletAddress);
  const existing = await readPath<unknown>(sparksPath(wallet));
  if (existing) {
    const normalized = normalizeSparkState(existing);
    const forRtdb = sparkStateForRtdb(normalized);
    const needsRewrite = JSON.stringify(forRtdb) !== JSON.stringify(existing);
    if (needsRewrite) {
      await writePath(sparksPath(wallet), forRtdb);
    }
    return normalized;
  }

  const initial = defaultSparkState();
  await writePath(sparksPath(wallet), sparkStateForRtdb(initial));
  return initial;
}

export async function getSparkSnapshotFromServer(
  walletAddress: string
): Promise<ReturnType<typeof computeSparkSnapshot>> {
  const state = await fetchSparkStateFromServer(walletAddress);
  return computeSparkSnapshot(state);
}

export class SparkSpendError extends Error {
  constructor(
    message: string,
    public readonly code: "NO_SPARKS" | "NO_WALLET"
  ) {
    super(message);
    this.name = "SparkSpendError";
  }
}

export class InfiniteSparkActivationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NO_WALLET"
      | "INVALID_TX"
      | "TX_ALREADY_USED"
  ) {
    super(message);
    this.name = "InfiniteSparkActivationError";
  }
}

export class SparkRefillActivationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NO_WALLET"
      | "INVALID_TX"
      | "TX_ALREADY_USED"
  ) {
    super(message);
    this.name = "SparkRefillActivationError";
  }
}

export class ScoreSubmitActivationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NO_WALLET"
      | "NO_NAME"
      | "INVALID_TX"
      | "TX_ALREADY_USED"
      | "NO_SCORE"
  ) {
    super(message);
    this.name = "ScoreSubmitActivationError";
  }
}

function sparkPaymentPath(txHash: string): string {
  return `sparkPayments/${txHash.toLowerCase()}`;
}

function scorePaymentPath(txHash: string): string {
  return `scorePayments/${txHash.toLowerCase()}`;
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
  let spent = false;
  let abortNoSparks = false;

  const { committed, snapshot } = await runRtdbTransaction<unknown>(
    sparksPath(wallet),
    (current) => {
      const state = normalizeSparkState(
        current ?? defaultSparkState(),
        now
      );

      if (state.infiniteUntil && state.infiniteUntil > now) {
        spent = false;
        return sparkStateForRtdb(state);
      }

      const readyIndex = findReadySparkSlotIndex(state.slots, now);
      if (readyIndex === -1) {
        abortNoSparks = true;
        return undefined;
      }

      const slots = [...state.slots];
      slots[readyIndex] = now + state.regenMs;
      spent = true;
      return sparkStateForRtdb({
        ...state,
        slots,
      });
    }
  );

  if (abortNoSparks || (!committed && !snapshot)) {
    throw new SparkSpendError("No Sparks available.", "NO_SPARKS");
  }

  const state = normalizeSparkState(
    snapshot ?? (await ensureSparkStateOnServer(wallet)),
    now
  );

  return {
    state,
    sparks: computeSparkSnapshot(state),
    spent,
  };
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

  const existingPayment = await readPath<{ wallet?: string }>(
    sparkPaymentPath(normalizedTxHash)
  );

  if (existingPayment?.wallet) {
    const recordedWallet = normalizeWalletAddress(existingPayment.wallet);
    if (recordedWallet !== wallet) {
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

  const nextState: StoredSparkState = {
    ...state,
    infiniteUntil,
  };

  await writePath(sparksPath(wallet), sparkStateForRtdb(nextState));
  await writePath(sparkPaymentPath(normalizedTxHash), {
    wallet,
    activatedAt: now,
    infiniteUntil,
  });

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

  const existingPayment = await readPath<{ wallet?: string; type?: string }>(
    sparkPaymentPath(normalizedTxHash)
  );

  if (existingPayment?.wallet) {
    const recordedWallet = normalizeWalletAddress(existingPayment.wallet);
    if (recordedWallet !== wallet) {
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
  const nextState: StoredSparkState = {
    ...state,
    slots: Array.from({ length: state.max }, () => null),
  };

  await writePath(sparksPath(wallet), sparkStateForRtdb(nextState));
  await writePath(sparkPaymentPath(normalizedTxHash), {
    wallet,
    type: "refill",
    activatedAt: now,
  });

  return {
    state: nextState,
    sparks: computeSparkSnapshot(nextState),
    refilled: true,
  };
}

// ─── Streak check-in + off-chain rewards ───────────────────────────────────────

function checkInTxPath(txHash: string): string {
  return `checkInTxs/${txHash.toLowerCase()}`;
}

function streakGrantPath(txHash: string): string {
  return `streakGrants/${txHash.toLowerCase()}`;
}

export class StreakSyncError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NO_WALLET"
      | "INVALID_TX"
      | "TX_ALREADY_USED"
  ) {
    super(message);
    this.name = "StreakSyncError";
  }
}

export class StreakRewardError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NO_WALLET"
      | "INVALID_TX"
      | "TX_ALREADY_USED"
      | "NO_MILESTONE"
  ) {
    super(message);
    this.name = "StreakRewardError";
  }
}

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

  const existing = await readPath<{ wallet?: string }>(
    checkInTxPath(normalizedTxHash)
  );

  if (existing?.wallet) {
    const recorded = normalizeWalletAddress(existing.wallet);
    if (recorded !== wallet) {
      throw new StreakSyncError(
        "This check-in was already used by another wallet.",
        "TX_ALREADY_USED"
      );
    }
    return { reused: true };
  }

  await writePath(checkInTxPath(normalizedTxHash), {
    wallet,
    campaignId,
    day,
    syncedAt: Date.now(),
  });

  return { reused: false };
}

/**
 * Grants Infinite Spark after a verified on-chain MilestoneReached for OFFCHAIN campaigns.
 * Attackers cannot call this usefully: require verified milestone tx for this wallet + one-time grant.
 */
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

  const existingGrant = await readPath<{ wallet?: string }>(
    streakGrantPath(normalizedTxHash)
  );

  if (existingGrant?.wallet) {
    const recorded = normalizeWalletAddress(existingGrant.wallet);
    if (recorded !== wallet) {
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

  const nextState: StoredSparkState = {
    ...state,
    infiniteUntil,
  };

  await writePath(sparksPath(wallet), sparkStateForRtdb(nextState));
  await writePath(streakGrantPath(normalizedTxHash), {
    wallet,
    campaignId,
    grantedAt: now,
    infiniteUntil,
    reward: "INFINITE_SPARK_24H",
  });

  return {
    state: nextState,
    sparks: computeSparkSnapshot(nextState),
    granted: true,
  };
}

// ─── Game gating flags (Firestore mirror for hot paths) ───────────────────────

function gameFlagsPath(gameId: string): string {
  return `gameFlags/${gameId}`;
}

export async function fetchGameGatingFlagsFromRtdb(
  gameId: string
): Promise<GameGatingFlags | null> {
  const cached = getCachedGameFlags(gameId);
  if (cached) return cached;

  const data = await readPath<GameGatingFlags>(gameFlagsPath(gameId));
  if (!data || typeof data !== "object") return null;
  const flags: GameGatingFlags = {
    active: data.active !== false,
    live: data.live !== false,
    hasLeaderboard: data.hasLeaderboard !== false,
    contestLive: data.contestLive === true,
    contestDurationDays: data.contestDurationDays,
    contestTask: data.contestTask,
    contestStartedAt: data.contestStartedAt,
    contestEndsAt: data.contestEndsAt,
  };
  setCachedGameFlags(gameId, flags);
  return flags;
}

export async function syncGameGatingFlagsToRtdb(
  gameId: string,
  flags: GameGatingFlags
): Promise<void> {
  await writePath(gameFlagsPath(gameId), flags);
  setCachedGameFlags(gameId, flags);
}

export async function deleteGameGatingFlagsFromRtdb(gameId: string): Promise<void> {
  const res = await rtdbFetch(gameFlagsPath(gameId), { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Realtime Database delete failed (${res.status}): ${text}`);
  }
  invalidateGameFlagsCache(gameId);
}

// ─── Game play counts ──────────────────────────────────────────────────────────

export async function fetchAllGamePlayCounts(): Promise<Record<string, number>> {
  const cached = getCachedPlayCounts();
  if (cached) return cached;

  const data = await readPath<Record<string, number>>("gamePlays");
  if (!data) {
    setCachedPlayCounts({});
    return {};
  }

  const counts: Record<string, number> = {};
  for (const [gameId, value] of Object.entries(data)) {
    counts[gameId] = typeof value === "number" ? value : 0;
  }
  setCachedPlayCounts(counts);
  return counts;
}

export async function fetchGamePlayCount(gameId: string): Promise<number> {
  const cached = getCachedPlayCounts();
  if (cached && typeof cached[gameId] === "number") {
    return cached[gameId];
  }

  const count = await readPath<number>(`gamePlays/${gameId}`);
  return typeof count === "number" ? count : 0;
}

/** Atomic increment — concurrent plays cannot lose counts. */
export async function incrementGamePlayCount(gameId: string): Promise<number> {
  await incrementPath(`gamePlays/${gameId}`, 1);

  const bumped = bumpCachedPlayCount(gameId, 1);
  if (typeof bumped === "number") return bumped;

  const count = await fetchGamePlayCount(gameId);
  return count;
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────
//
// Layout (new):
//   leaderboards/{gameId}/entries/{wallet|name_*}  — full history (never delete)
//   leaderboards/{gameId}/top/{wallet|name_*}      — small top-N mirror for reads
// Legacy flat keys under leaderboards/{gameId}/{wallet} are still read as fallback.

function leaderboardEntriesPath(gameId: string, storageKey: string): string {
  return `leaderboards/${gameId}/entries/${storageKey}`;
}

function leaderboardTopPath(gameId: string): string {
  return `leaderboards/${gameId}/top`;
}

function leaderboardLegacyEntryPath(gameId: string, storageKey: string): string {
  return `leaderboards/${gameId}/${storageKey}`;
}

function contestLeaderboardPath(
  gameId: string,
  contestStartedAt: number
): string {
  return `contestLeaderboards/${gameId}/${contestStartedAt}`;
}

function contestEntriesPath(
  gameId: string,
  contestStartedAt: number,
  wallet: string
): string {
  return `${contestLeaderboardPath(gameId, contestStartedAt)}/entries/${wallet}`;
}

function contestTopPath(gameId: string, contestStartedAt: number): string {
  return `${contestLeaderboardPath(gameId, contestStartedAt)}/top`;
}

function entriesToTopMap(entries: LeaderboardEntry[]): LeaderboardMap {
  const map: LeaderboardMap = {};
  for (const entry of entries) {
    map[leaderboardStorageKey(entry)] = entry;
  }
  return map;
}

function mergeIntoTopMirror(
  currentTop: LeaderboardMap | null,
  payload: LeaderboardEntry,
  mirrorSize: number
): LeaderboardMap | null {
  const ranked = deduplicateLeaderboardEntries(
    mapToLeaderboardEntries(currentTop)
  ).sort((a, b) => b.score - a.score);

  const userKey = leaderboardUserKey(payload);
  const withoutUser = ranked.filter((e) => leaderboardUserKey(e) !== userKey);
  const lowestKept = withoutUser[mirrorSize - 1];

  const alreadyInTop = ranked.some((e) => leaderboardUserKey(e) === userKey);
  if (
    !alreadyInTop &&
    withoutUser.length >= mirrorSize &&
    lowestKept &&
    payload.score < lowestKept.score
  ) {
    return null;
  }

  const next = [...withoutUser, payload]
    .sort((a, b) => b.score - a.score)
    .slice(0, mirrorSize);

  return entriesToTopMap(next);
}

async function loadLegacyLeaderboardMap(
  gameId: string
): Promise<LeaderboardMap | null> {
  const root = await readPath<Record<string, unknown>>(`leaderboards/${gameId}`);
  if (!root || typeof root !== "object") return null;

  const map: LeaderboardMap = {};
  for (const [key, value] of Object.entries(root)) {
    if (key === "top" || key === "entries") continue;
    if (!value || typeof value !== "object") continue;
    const entry = value as LeaderboardEntry;
    if (typeof entry.score !== "number" || typeof entry.name !== "string") {
      continue;
    }
    map[key] = entry;
  }
  return Object.keys(map).length > 0 ? map : null;
}

async function ensureLeaderboardTopMirror(
  gameId: string
): Promise<LeaderboardEntry[]> {
  const top = await readPath<LeaderboardMap>(leaderboardTopPath(gameId));
  if (top && Object.keys(top).length > 0) {
    return deduplicateLeaderboardEntries(mapToLeaderboardEntries(top)).sort(
      (a, b) => b.score - a.score
    );
  }

  // One-time rebuild: merge nested entries + legacy flat keys, then seed top.
  const [nested, legacy] = await Promise.all([
    readPath<LeaderboardMap>(`leaderboards/${gameId}/entries`),
    loadLegacyLeaderboardMap(gameId),
  ]);

  const ranked = deduplicateLeaderboardEntries([
    ...mapToLeaderboardEntries(nested),
    ...mapToLeaderboardEntries(legacy),
  ])
    .sort((a, b) => b.score - a.score)
    .slice(0, LEADERBOARD_TOP_MIRROR_SIZE);

  if (ranked.length > 0) {
    await writePath(leaderboardTopPath(gameId), entriesToTopMap(ranked)).catch(
      () => {}
    );
  }

  return ranked;
}

async function ensureContestTopMirror(
  gameId: string,
  contestStartedAt: number
): Promise<LeaderboardEntry[]> {
  const base = contestLeaderboardPath(gameId, contestStartedAt);
  const top = await readPath<LeaderboardMap>(
    contestTopPath(gameId, contestStartedAt)
  );
  if (top && Object.keys(top).length > 0) {
    return deduplicateLeaderboardEntries(mapToLeaderboardEntries(top)).sort(
      (a, b) => b.score - a.score
    );
  }

  const [nested, legacyRoot] = await Promise.all([
    readPath<LeaderboardMap>(`${base}/entries`),
    readPath<Record<string, unknown>>(base),
  ]);

  const legacy: LeaderboardMap = {};
  if (legacyRoot) {
    for (const [key, value] of Object.entries(legacyRoot)) {
      if (key === "top" || key === "entries") continue;
      if (!value || typeof value !== "object") continue;
      const entry = value as LeaderboardEntry;
      if (typeof entry.score !== "number" || typeof entry.name !== "string") {
        continue;
      }
      legacy[key] = entry;
    }
  }

  const ranked = deduplicateLeaderboardEntries([
    ...mapToLeaderboardEntries(nested),
    ...mapToLeaderboardEntries(legacy),
  ])
    .sort((a, b) => b.score - a.score)
    .slice(0, CONTEST_TOP_MIRROR_SIZE);

  if (ranked.length > 0) {
    await writePath(
      contestTopPath(gameId, contestStartedAt),
      entriesToTopMap(ranked)
    ).catch(() => {});
  }

  return ranked;
}

export async function fetchLeaderboardFromServer(
  gameId: string,
  limit = LEADERBOARD_MAX_ENTRIES
): Promise<LeaderboardEntry[]> {
  const ranked = await ensureLeaderboardTopMirror(gameId);
  return ranked.slice(0, limit);
}

/** Best score officially submitted to the public leaderboard. */
export async function fetchUserSubmittedScoreFromServer(
  gameId: string,
  opts: { walletAddress?: string; playerName?: string }
): Promise<number> {
  const wallet = tryNormalizeWalletAddress(opts.walletAddress);
  const name = opts.playerName?.trim().toLowerCase();
  if (!wallet && !name) return 0;

  if (wallet) {
    const key = wallet;
    const fromEntries = await readPath<LeaderboardEntry>(
      leaderboardEntriesPath(gameId, key)
    );
    if (fromEntries && typeof fromEntries.score === "number") {
      return fromEntries.score;
    }

    const legacy = await readPath<LeaderboardEntry>(
      leaderboardLegacyEntryPath(gameId, key)
    );
    if (legacy && typeof legacy.score === "number") {
      return legacy.score;
    }
  }

  if (name) {
    const key = `name_${name.replace(/[.#$[\]/]/g, "_")}`;
    const fromEntries = await readPath<LeaderboardEntry>(
      leaderboardEntriesPath(gameId, key)
    );
    if (fromEntries && typeof fromEntries.score === "number") {
      return fromEntries.score;
    }

    const legacy = await readPath<LeaderboardEntry>(
      leaderboardLegacyEntryPath(gameId, key)
    );
    if (legacy && typeof legacy.score === "number") {
      return legacy.score;
    }
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
  const existing =
    (await readPath<LeaderboardEntry>(
      leaderboardEntriesPath(gameId, storageKey)
    )) ??
    (await readPath<LeaderboardEntry>(
      leaderboardLegacyEntryPath(gameId, storageKey)
    ));

  if (existing && typeof existing.score === "number" && existing.score >= payload.score) {
    return;
  }

  // Full history under entries/. Top mirror stays O(N) small for reads.
  await writePath(leaderboardEntriesPath(gameId, storageKey), payload);

  const top = await readPath<LeaderboardMap>(leaderboardTopPath(gameId));
  const nextTop = mergeIntoTopMirror(top, payload, LEADERBOARD_TOP_MIRROR_SIZE);
  if (nextTop) {
    await writePath(leaderboardTopPath(gameId), nextTop);
  } else if (!top || Object.keys(top).length === 0) {
    // Cold start: seed top from this first qualifying write.
    await writePath(leaderboardTopPath(gameId), entriesToTopMap([payload]));
  }
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

  const existing =
    (await readPath<LeaderboardEntry>(
      contestEntriesPath(gameId, contestStartedAt, wallet)
    )) ??
    (await readPath<LeaderboardEntry>(
      `${contestLeaderboardPath(gameId, contestStartedAt)}/${wallet}`
    ));

  if (existing && typeof existing.score === "number" && existing.score >= payload.score) {
    return;
  }

  await writePath(contestEntriesPath(gameId, contestStartedAt, wallet), payload);

  const top = await readPath<LeaderboardMap>(
    contestTopPath(gameId, contestStartedAt)
  );
  const nextTop = mergeIntoTopMirror(top, payload, CONTEST_TOP_MIRROR_SIZE);
  if (nextTop) {
    await writePath(contestTopPath(gameId, contestStartedAt), nextTop);
  } else if (!top || Object.keys(top).length === 0) {
    await writePath(
      contestTopPath(gameId, contestStartedAt),
      entriesToTopMap([payload])
    );
  }
}

export async function fetchContestLeaderboardFromServer(
  gameId: string,
  contestStartedAt: number,
  limit = CONTEST_MAX_ENTRIES
): Promise<LeaderboardEntry[]> {
  const ranked = await ensureContestTopMirror(gameId, contestStartedAt);
  return ranked.slice(0, limit);
}

// ─── Per-user game progress ───────────────────────────────────────────────────

function gameProgressPath(walletAddress: string, gameId: string): string {
  return `users/${normalizeWalletAddress(walletAddress)}/games/${gameId}`;
}

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
  return readPath<StoredGameProgress>(gameProgressPath(walletAddress, gameId));
}

/**
 * Resolves progress for API / bootstrap. Personal best lives in users/{wallet}/games/{gameId}.s
 * and is never auto-synced to the public leaderboard.
 */
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

  const existingPayment = await readPath<{
    wallet?: string;
    gameId?: string;
    score?: number;
  }>(scorePaymentPath(normalizedTxHash));

  if (existingPayment?.wallet) {
    const recordedWallet = normalizeWalletAddress(existingPayment.wallet);
    if (recordedWallet !== wallet) {
      throw new ScoreSubmitActivationError(
        "This payment was already used by another wallet.",
        "TX_ALREADY_USED"
      );
    }

    const leaderboardScore = await fetchUserSubmittedScoreFromServer(gameId, {
      walletAddress: wallet,
      playerName,
    });

    return {
      highScore,
      leaderboardScore,
      submitted: false,
    };
  }

  await verifyScoreSubmitPaymentTx(wallet, normalizedTxHash as Hash);

  await submitLeaderboardEntryOnServer(gameId, {
    name: playerName,
    score,
    walletAddress: wallet,
  });

  if (typeof opts?.contestStartedAt === "number") {
    await submitContestLeaderboardEntryOnServer(gameId, opts.contestStartedAt, {
      name: playerName,
      score,
      walletAddress: wallet,
      createdAt: Date.now(),
    });
  }

  const leaderboardScore = await fetchUserSubmittedScoreFromServer(gameId, {
    walletAddress: wallet,
    playerName,
  });

  const now = Date.now();
  await writePath(scorePaymentPath(normalizedTxHash), {
    wallet,
    gameId,
    score,
    activatedAt: now,
  });

  return {
    highScore,
    leaderboardScore,
    submitted: true,
  };
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
    const current = await fetchGameProgressFromServer(wallet, gameId);
    const field: "s" | "l" = hasLeaderboard ? "s" : "l";
    const currentValue = hasLeaderboard
      ? readStoredScore(current)
      : (current?.l ?? 0);

    if (maxValue <= currentValue) {
      return storedProgressToGameProgress(current, hasLeaderboard);
    }

    await patchPath(gameProgressPath(wallet, gameId), { [field]: maxValue });

    const updated: StoredGameProgress = { ...current, [field]: maxValue };
    return storedProgressToGameProgress(updated, hasLeaderboard);
  });
}
