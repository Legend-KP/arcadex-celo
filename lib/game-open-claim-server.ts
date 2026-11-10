/**
 * Server store + status for per-game on-chain open claims (D1 or RTDB).
 */

import { useD1PlayerData, requireD1 } from "@/lib/d1-client";
import {
  GAME_OPEN_CLAIM_AMOUNT_MICRO,
  GAME_OPEN_CLAIM_DAILY_CAP,
  GAME_OPEN_CLAIM_PER_WALLET_DAILY,
  GAME_OPEN_CLAIM_USDT,
  gameOpenClaimDayKey,
  type GameOpenClaimRecord,
} from "@/lib/game-open-claim";
import { resolveGameOpenCampaignIdForGame } from "@/lib/game-open-campaigns";
import {
  isGameVisibleFromFlags,
  resolveGameGating,
} from "@/lib/game-gating";
import { isWalletAddress, normalizeWalletAddress } from "@/lib/wallet-address";
import {
  deletePath,
  readPath,
  runRtdbTransaction,
  writePath,
} from "@/lib/rtdb-server";
import { readStreakProgress } from "@/lib/arcadex-rewards-verify";
import { getCeloPublicClient } from "@/lib/celo-public-client";
import { getAddress, type Address } from "viem";
import { matchGameOpenCampaignId } from "@/lib/game-open-campaign-ids";
import {
  ARCADEX_REWARDS_ABI,
  ARCADEX_REWARDS_CONTRACT_ADDRESS,
  CAMPAIGN_TYPE_SHUFFLE,
} from "@/lib/arcadex-rewards";

export class GameOpenClaimError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NO_WALLET"
      | "NO_GAME"
      | "NOT_LIVE"
      | "NO_CAMPAIGN"
      | "INACTIVE"
      | "WRONG_TYPE"
      | "ALREADY_CLAIMED"
      | "TOO_SOON"
      | "DAILY_CAP"
      | "WALLET_DAILY_CAP"
      | "PAYOUT_FAILED"
  ) {
    super(message);
    this.name = "GameOpenClaimError";
  }
}

function claimPath(wallet: string, utcDay: string, gameId: string): string {
  return `gameOpenClaims/${wallet.toLowerCase()}/${utcDay}/${gameId}`;
}

function dailyCountPath(utcDay: string): string {
  return `gameOpenClaimDailyCount/${utcDay}`;
}

function walletDailyCountPath(wallet: string, utcDay: string): string {
  return `gameOpenClaimWalletDaily/${wallet.toLowerCase()}/${utcDay}`;
}

let capTableReady = false;
let walletCapTableReady = false;

async function ensureDailyCapTable(
  db: Awaited<ReturnType<typeof requireD1>>
): Promise<void> {
  if (capTableReady) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS game_open_claim_daily (
         utc_day TEXT PRIMARY KEY,
         claim_count INTEGER NOT NULL
       )`
    )
    .run();
  capTableReady = true;
}

async function ensureWalletCapTable(
  db: Awaited<ReturnType<typeof requireD1>>
): Promise<void> {
  if (walletCapTableReady) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS game_open_claim_wallet_daily (
         wallet TEXT NOT NULL,
         utc_day TEXT NOT NULL,
         reserved_count INTEGER NOT NULL,
         PRIMARY KEY (wallet, utc_day)
       )`
    )
    .run();
  walletCapTableReady = true;
}

/** Seed today's global row from reserved slots (pending + claimed). */
async function ensureDailyClaimRow(
  db: Awaited<ReturnType<typeof requireD1>>,
  utcDay: string
): Promise<void> {
  await ensureDailyCapTable(db);
  await db
    .prepare(
      `INSERT INTO game_open_claim_daily (utc_day, claim_count)
       SELECT ?, COUNT(*) FROM game_open_claims
       WHERE utc_day = ? AND status IN ('pending', 'paying', 'claimed')
       ON CONFLICT(utc_day) DO NOTHING`
    )
    .bind(utcDay, utcDay)
    .run();
}

/** Seed this wallet's day row from reserved slots (pending + claimed). */
async function ensureWalletClaimRow(
  db: Awaited<ReturnType<typeof requireD1>>,
  wallet: string,
  utcDay: string
): Promise<void> {
  await ensureWalletCapTable(db);
  await db
    .prepare(
      `INSERT INTO game_open_claim_wallet_daily (wallet, utc_day, reserved_count)
       SELECT ?, ?, COUNT(*) FROM game_open_claims
       WHERE wallet = ? AND utc_day = ?
         AND status IN ('pending', 'paying', 'claimed')
       ON CONFLICT(wallet, utc_day) DO NOTHING`
    )
    .bind(wallet, utcDay, wallet, utcDay)
    .run();
}

async function readDailyClaimCount(utcDay: string): Promise<number> {
  if (await useD1PlayerData()) {
    const db = await requireD1();
    await ensureDailyClaimRow(db, utcDay);
    const row = await db
      .prepare(
        `SELECT claim_count AS n FROM game_open_claim_daily WHERE utc_day = ?`
      )
      .bind(utcDay)
      .first<{ n: number }>();
    return Number(row?.n ?? 0);
  }

  const stored = await readPath<number>(dailyCountPath(utcDay));
  return typeof stored === "number" && Number.isFinite(stored) ? stored : 0;
}

async function readWalletReservedCount(
  wallet: string,
  utcDay: string
): Promise<number> {
  if (await useD1PlayerData()) {
    const db = await requireD1();
    await ensureWalletClaimRow(db, wallet, utcDay);
    const row = await db
      .prepare(
        `SELECT reserved_count AS n FROM game_open_claim_wallet_daily
         WHERE wallet = ? AND utc_day = ?`
      )
      .bind(wallet, utcDay)
      .first<{ n: number }>();
    return Number(row?.n ?? 0);
  }

  const stored = await readPath<number>(walletDailyCountPath(wallet, utcDay));
  return typeof stored === "number" && Number.isFinite(stored) ? stored : 0;
}

/** True while this wallet still has an open-claim slot today. */
export async function isWalletGameOpenClaimsOpen(
  walletAddress: string,
  now = Date.now()
): Promise<boolean> {
  if (!isWalletAddress(walletAddress)) return true;
  const wallet = normalizeWalletAddress(walletAddress);
  const count = await readWalletReservedCount(wallet, gameOpenClaimDayKey(now));
  return count < GAME_OPEN_CLAIM_PER_WALLET_DAILY;
}

/** True while this UTC day still has room for a new game-open claim. */
export async function isGameOpenClaimDayOpen(
  now = Date.now()
): Promise<boolean> {
  const count = await readDailyClaimCount(gameOpenClaimDayKey(now));
  return count < GAME_OPEN_CLAIM_DAILY_CAP;
}

const POOL_CACHE_MS = 20_000;
let poolCache: { at: number; open: boolean } | null = null;

/** True while unreserved USDT can fund one new 0.01 game-open claim. */
export async function isGameOpenPoolOpen(): Promise<boolean> {
  const now = Date.now();
  if (poolCache && now - poolCache.at < POOL_CACHE_MS) return poolCache.open;
  try {
    const available = (await getCeloPublicClient().readContract({
      address: ARCADEX_REWARDS_CONTRACT_ADDRESS,
      abi: ARCADEX_REWARDS_ABI,
      functionName: "availableUSDT",
    })) as bigint;
    const open = available >= BigInt(GAME_OPEN_CLAIM_AMOUNT_MICRO);
    poolCache = { at: now, open };
    return open;
  } catch {
    return poolCache?.open ?? true;
  }
}

/** New claims need both a remaining daily slot and enough unreserved USDT. */
export async function areNewGameOpenClaimsOpen(
  now = Date.now()
): Promise<boolean> {
  if (!(await isGameOpenClaimDayOpen(now))) return false;
  return isGameOpenPoolOpen();
}

export async function assertLiveGame(gameId: string): Promise<void> {
  const id = gameId.trim();
  if (!id) {
    throw new GameOpenClaimError("gameId is required.", "NO_GAME");
  }
  const flags = await resolveGameGating(id);
  if (!flags || !isGameVisibleFromFlags(flags)) {
    throw new GameOpenClaimError("Game not found.", "NO_GAME");
  }
  if (flags.live === false) {
    throw new GameOpenClaimError("Game is not live yet.", "NOT_LIVE");
  }
}

export async function requireGameOpenCampaign(
  gameId: string,
  gameNameHint?: string
): Promise<number> {
  const campaignId = await resolveGameOpenCampaignIdForGame(
    gameId,
    gameNameHint
  );
  if (campaignId == null) {
    throw new GameOpenClaimError(
      "This game has no open-claim campaign configured yet.",
      "NO_CAMPAIGN"
    );
  }
  return campaignId;
}

export async function getGameOpenClaimStatus(
  walletAddress: string,
  gameId: string,
  gameNameHint?: string
): Promise<{
  claimed: boolean;
  amountUsdt: number;
  campaignId: number | null;
  utcDay: string;
  payoutsEnabled: boolean;
  canClaim: boolean;
  claimsOpen: boolean;
  walletClaimsOpen: boolean;
}> {
  const utcDay = gameOpenClaimDayKey();
  const amountUsdt = GAME_OPEN_CLAIM_USDT;
  const claimsOpen = await areNewGameOpenClaimsOpen();
  const campaignId = await resolveGameOpenCampaignIdForGame(
    gameId,
    gameNameHint
  );

  if (!campaignId) {
    return {
      claimed: false,
      amountUsdt,
      campaignId: null,
      utcDay,
      payoutsEnabled: false,
      canClaim: false,
      claimsOpen,
      walletClaimsOpen: true,
    };
  }

  if (!isWalletAddress(walletAddress)) {
    return {
      claimed: false,
      amountUsdt,
      campaignId,
      utcDay,
      payoutsEnabled: true,
      canClaim: claimsOpen,
      claimsOpen,
      walletClaimsOpen: true,
    };
  }

  const wallet = normalizeWalletAddress(walletAddress);
  const walletClaimsOpen = await isWalletGameOpenClaimsOpen(wallet);
  const ledgerStatus = await readLedgerStatus(wallet, gameId, utcDay);

  if (ledgerStatus === "claimed") {
    return {
      claimed: true,
      amountUsdt,
      campaignId,
      utcDay,
      payoutsEnabled: true,
      canClaim: false,
      claimsOpen,
      walletClaimsOpen,
    };
  }

  // Already reserved this game today — allow finishing even at the wallet cap.
  if (ledgerStatus === "pending" || ledgerStatus === "paying") {
    return {
      claimed: false,
      amountUsdt,
      campaignId,
      utcDay,
      payoutsEnabled: true,
      canClaim: true,
      claimsOpen,
      walletClaimsOpen,
    };
  }

  // On-chain: SHUFFLE one spin per UTC day per campaign.
  try {
    const progress = await readStreakProgress(wallet, campaignId);
    const active =
      progress.campaign.active &&
      !progress.campaign.cancelled &&
      Number(progress.campaign.campaignType) === CAMPAIGN_TYPE_SHUFFLE;
    const claimedOnChain = !progress.canCheckIn && progress.lastCheckInAt > 0;
    return {
      claimed: claimedOnChain,
      amountUsdt,
      campaignId,
      utcDay,
      payoutsEnabled: active,
      canClaim:
        claimsOpen &&
        walletClaimsOpen &&
        active &&
        progress.canCheckIn,
      claimsOpen,
      walletClaimsOpen,
    };
  } catch {
    return {
      claimed: false,
      amountUsdt,
      campaignId,
      utcDay,
      payoutsEnabled: true,
      canClaim: claimsOpen && walletClaimsOpen,
      claimsOpen,
      walletClaimsOpen,
    };
  }
}

export type GameOpenClaimStatusRow = {
  claimed: boolean;
  amountUsdt: number;
  campaignId: number | null;
  utcDay: string;
  payoutsEnabled: boolean;
  canClaim: boolean;
  claimsOpen: boolean;
  walletClaimsOpen: boolean;
};

const CAMPAIGN_CACHE_MS = 10 * 60_000;
const STATUS_BATCH_CACHE_MS = 20_000;
const STATUS_BATCH_MAX_GAMES = 40;

type CampaignSnap = { payoutsEnabled: boolean; at: number };

const campaignSnapCache = new Map<number, CampaignSnap>();
const statusBatchCache = new Map<
  string,
  { at: number; value: GameOpenClaimBatch }
>();

export type GameOpenClaimBatch = {
  utcDay: string;
  claimsOpen: boolean;
  /** False once this wallet has reserved 8 slots today (pending + claimed). */
  walletClaimsOpen: boolean;
  byGameId: Record<string, GameOpenClaimStatusRow>;
};

function freshCampaignSnap(campaignId: number): CampaignSnap | null {
  const snap = campaignSnapCache.get(campaignId);
  if (!snap || Date.now() - snap.at >= CAMPAIGN_CACHE_MS) return null;
  return snap;
}

function rememberCampaignSnap(campaignId: number, payoutsEnabled: boolean): void {
  campaignSnapCache.set(campaignId, { payoutsEnabled, at: Date.now() });
}

function campaignPayoutsEnabled(result: unknown): boolean | null {
  if (!Array.isArray(result) || result.length < 4) return null;
  const active = Boolean(result[0]);
  const cancelled = Boolean(result[1]);
  const campaignType = Number(result[3]);
  return (
    active && !cancelled && campaignType === CAMPAIGN_TYPE_SHUFFLE
  );
}

function progressFromChain(
  result: unknown
): { claimed: boolean; canCheckIn: boolean } | null {
  if (!Array.isArray(result) || result.length < 6) return null;
  const lastCheckInAt = Number(result[1]);
  const canCheckIn = Boolean(result[5]);
  return {
    claimed: !canCheckIn && Number.isFinite(lastCheckInAt) && lastCheckInAt > 0,
    canCheckIn,
  };
}

function dropStatusBatchCache(wallet: string): void {
  const prefix = `${wallet}|`;
  for (const key of statusBatchCache.keys()) {
    if (key.startsWith(prefix)) statusBatchCache.delete(key);
  }
}

type LedgerStatus = "pending" | "paying" | "claimed";

async function readLedgerStatuses(
  wallet: string,
  utcDay: string,
  gameIds: string[]
): Promise<Map<string, LedgerStatus>> {
  const out = new Map<string, LedgerStatus>();
  if (gameIds.length === 0) return out;

  if (await useD1PlayerData()) {
    const db = await requireD1();
    const placeholders = gameIds.map(() => "?").join(", ");
    const { results } = await db
      .prepare(
        `SELECT game_id, status FROM game_open_claims
         WHERE wallet = ? AND utc_day = ?
           AND game_id IN (${placeholders})
           AND status IN ('pending', 'paying', 'claimed')`
      )
      .bind(wallet, utcDay, ...gameIds)
      .all<{ game_id: string; status: string }>();
    for (const row of results ?? []) {
      if (
        row.status === "pending" ||
        row.status === "paying" ||
        row.status === "claimed"
      ) {
        out.set(row.game_id, row.status);
      }
    }
    return out;
  }

  const dayNode = await readPath<Record<string, GameOpenClaimRecord | null>>(
    `gameOpenClaims/${wallet.toLowerCase()}/${utcDay}`
  );
  if (!dayNode || typeof dayNode !== "object") return out;
  for (const id of gameIds) {
    const status = dayNode[id]?.status;
    if (status === "pending" || status === "paying" || status === "claimed") {
      out.set(id, status);
    }
  }
  return out;
}

/**
 * One Worker invocation for the whole home grid.
 * Per-game /status calls each paid a full Next.js boot plus two chain reads.
 */
export async function listGameOpenClaimStatuses(
  walletAddress: string,
  games: { id: string; name?: string }[]
): Promise<GameOpenClaimBatch> {
  const utcDay = gameOpenClaimDayKey();
  const amountUsdt = GAME_OPEN_CLAIM_USDT;
  const seen = new Set<string>();
  const unique: { id: string; name?: string }[] = [];
  for (const game of games) {
    const id = game.id?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push({ id, name: game.name });
    if (unique.length >= STATUS_BATCH_MAX_GAMES) break;
  }

  const wallet = isWalletAddress(walletAddress)
    ? normalizeWalletAddress(walletAddress)
    : "";
  const cacheKey = `${wallet}|${utcDay}|${unique
    .map((game) => game.id)
    .sort()
    .join(",")}`;
  const cached = statusBatchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < STATUS_BATCH_CACHE_MS) {
    return cached.value;
  }

  const claimsOpen = await areNewGameOpenClaimsOpen();
  const walletClaimsOpen = wallet
    ? await isWalletGameOpenClaimsOpen(wallet)
    : true;
  const byGameId: Record<string, GameOpenClaimStatusRow> = {};
  const withCampaign: { id: string; campaignId: number }[] = [];

  for (const game of unique) {
    const campaignId = matchGameOpenCampaignId(game.id, game.name);
    if (campaignId == null) {
      byGameId[game.id] = {
        claimed: false,
        amountUsdt,
        campaignId: null,
        utcDay,
        payoutsEnabled: false,
        canClaim: false,
        claimsOpen,
        walletClaimsOpen,
      };
      continue;
    }
    withCampaign.push({ id: game.id, campaignId });
  }

  if (!wallet) {
    for (const game of withCampaign) {
      byGameId[game.id] = {
        claimed: false,
        amountUsdt,
        campaignId: game.campaignId,
        utcDay,
        payoutsEnabled: true,
        canClaim: claimsOpen,
        claimsOpen,
        walletClaimsOpen: true,
      };
    }
    const value = { utcDay, claimsOpen, walletClaimsOpen: true, byGameId };
    statusBatchCache.set(cacheKey, { at: Date.now(), value });
    return value;
  }

  const ledgerByGame = await readLedgerStatuses(
    wallet,
    utcDay,
    withCampaign.map((game) => game.id)
  );
  const needsChain: { id: string; campaignId: number }[] = [];
  for (const game of withCampaign) {
    const ledger = ledgerByGame.get(game.id);
    if (ledger === "claimed") {
      byGameId[game.id] = {
        claimed: true,
        amountUsdt,
        campaignId: game.campaignId,
        utcDay,
        payoutsEnabled: true,
        canClaim: false,
        claimsOpen,
        walletClaimsOpen,
      };
      continue;
    }
    if (ledger === "pending" || ledger === "paying") {
      byGameId[game.id] = {
        claimed: false,
        amountUsdt,
        campaignId: game.campaignId,
        utcDay,
        payoutsEnabled: true,
        canClaim: true,
        claimsOpen,
        walletClaimsOpen,
      };
      continue;
    }
    needsChain.push(game);
  }

  const player = getAddress(wallet) as Address;
  type TaggedCall =
    | { kind: "campaign"; campaignId: number }
    | { kind: "progress"; gameId: string };
  const tagged: TaggedCall[] = [];
  const contracts: {
    address: typeof ARCADEX_REWARDS_CONTRACT_ADDRESS;
    abi: typeof ARCADEX_REWARDS_ABI;
    functionName: "getCampaign" | "getProgress";
    args: readonly [bigint] | readonly [Address, bigint];
  }[] = [];

  const campaignIds = [...new Set(needsChain.map((game) => game.campaignId))];
  for (const campaignId of campaignIds) {
    if (freshCampaignSnap(campaignId)) continue;
    tagged.push({ kind: "campaign", campaignId });
    contracts.push({
      address: ARCADEX_REWARDS_CONTRACT_ADDRESS,
      abi: ARCADEX_REWARDS_ABI,
      functionName: "getCampaign",
      args: [BigInt(campaignId)],
    });
  }
  for (const game of needsChain) {
    tagged.push({ kind: "progress", gameId: game.id });
    contracts.push({
      address: ARCADEX_REWARDS_CONTRACT_ADDRESS,
      abi: ARCADEX_REWARDS_ABI,
      functionName: "getProgress",
      args: [player, BigInt(game.campaignId)],
    });
  }

  const progressByGame = new Map<
    string,
    { claimed: boolean; canCheckIn: boolean }
  >();

  if (contracts.length > 0) {
    try {
      const results = await getCeloPublicClient().multicall({
        contracts,
        allowFailure: true,
      });
      results.forEach((entry, index) => {
        const tag = tagged[index];
        if (!tag || entry.status !== "success") return;
        if (tag.kind === "campaign") {
          const enabled = campaignPayoutsEnabled(entry.result);
          if (enabled != null) rememberCampaignSnap(tag.campaignId, enabled);
          return;
        }
        const progress = progressFromChain(entry.result);
        if (progress) progressByGame.set(tag.gameId, progress);
      });
    } catch {
      // Same fallback as the single-game status route: still show Claim.
    }
  }

  for (const game of needsChain) {
    const snap = freshCampaignSnap(game.campaignId);
    const progress = progressByGame.get(game.id);
    if (!progress || !snap) {
      byGameId[game.id] = {
        claimed: false,
        amountUsdt,
        campaignId: game.campaignId,
        utcDay,
        payoutsEnabled: true,
        canClaim: claimsOpen && walletClaimsOpen,
        claimsOpen,
        walletClaimsOpen,
      };
      continue;
    }
    byGameId[game.id] = {
      claimed: progress.claimed,
      amountUsdt,
      campaignId: game.campaignId,
      utcDay,
      payoutsEnabled: snap.payoutsEnabled,
      canClaim:
        claimsOpen &&
        walletClaimsOpen &&
        snap.payoutsEnabled &&
        progress.canCheckIn,
      claimsOpen,
      walletClaimsOpen,
    };
  }

  const value = { utcDay, claimsOpen, walletClaimsOpen, byGameId };
  if (statusBatchCache.size > 200) {
    const now = Date.now();
    for (const [key, entry] of statusBatchCache) {
      if (now - entry.at >= STATUS_BATCH_CACHE_MS) statusBatchCache.delete(key);
    }
  }
  statusBatchCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

async function readLedgerStatus(
  wallet: string,
  gameId: string,
  utcDay: string
): Promise<LedgerStatus | null> {
  if (await useD1PlayerData()) {
    const db = await requireD1();
    const row = await db
      .prepare(
        `SELECT status FROM game_open_claims
         WHERE wallet = ? AND game_id = ? AND utc_day = ?`
      )
      .bind(wallet, gameId, utcDay)
      .first<{ status: string }>();
    if (
      row?.status === "pending" ||
      row?.status === "paying" ||
      row?.status === "claimed"
    ) {
      return row.status;
    }
    return null;
  }

  const existing = await readPath<GameOpenClaimRecord>(
    claimPath(wallet, utcDay, gameId)
  );
  const status = existing?.status;
  if (status === "pending" || status === "paying" || status === "claimed") {
    return status;
  }
  return null;
}

/**
 * Atomically reserve one open-claim slot for (wallet, game, day).
 * Counts pending + claimed toward both the per-wallet 8 and global 6000 caps.
 * Re-signing an existing pending row does not consume another slot.
 */
export async function reserveGameOpenClaim(opts: {
  walletAddress: string;
  gameId: string;
  campaignId: number;
  nonce: number;
  signature: string;
  deadline: number;
}): Promise<void> {
  const wallet = normalizeWalletAddress(opts.walletAddress);
  const utcDay = gameOpenClaimDayKey();
  const now = Date.now();
  dropStatusBatchCache(wallet);

  if (await useD1PlayerData()) {
    await reserveGameOpenClaimD1(wallet, utcDay, now, opts);
    return;
  }

  await reserveGameOpenClaimRtdb(wallet, utcDay, now, opts);
}

async function reserveGameOpenClaimD1(
  wallet: string,
  utcDay: string,
  now: number,
  opts: {
    gameId: string;
    campaignId: number;
    nonce: number;
    signature: string;
    deadline: number;
  }
): Promise<void> {
  const db = await requireD1();
  await ensureDailyClaimRow(db, utcDay);
  await ensureWalletClaimRow(db, wallet, utcDay);

  const existing = await db
    .prepare(
      `SELECT status FROM game_open_claims
       WHERE wallet = ? AND game_id = ? AND utc_day = ?`
    )
    .bind(wallet, opts.gameId, utcDay)
    .first<{ status: string }>();

  if (existing?.status === "claimed") {
    throw new GameOpenClaimError(
      "Already claimed today's open reward for this game.",
      "ALREADY_CLAIMED"
    );
  }

  if (existing?.status === "pending" || existing?.status === "paying") {
    await db
      .prepare(
        `UPDATE game_open_claims
         SET campaign_id = ?, status = 'pending'
         WHERE wallet = ? AND game_id = ? AND utc_day = ?
           AND status IN ('pending', 'paying')`
      )
      .bind(opts.campaignId, wallet, opts.gameId, utcDay)
      .run();
    return;
  }

  // Insert first so same-game races share one row (no double counter bump).
  const inserted = await db
    .prepare(
      `INSERT OR IGNORE INTO game_open_claims
       (wallet, game_id, utc_day, campaign_id, amount_micro, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`
    )
    .bind(
      wallet,
      opts.gameId,
      utcDay,
      opts.campaignId,
      GAME_OPEN_CLAIM_AMOUNT_MICRO,
      now
    )
    .run();

  if (!inserted.meta?.changes) {
    const raced = await db
      .prepare(
        `SELECT status FROM game_open_claims
         WHERE wallet = ? AND game_id = ? AND utc_day = ?`
      )
      .bind(wallet, opts.gameId, utcDay)
      .first<{ status: string }>();
    if (raced?.status === "claimed") {
      throw new GameOpenClaimError(
        "Already claimed today's open reward for this game.",
        "ALREADY_CLAIMED"
      );
    }
    // Another request reserved this game — reuse that slot.
    return;
  }

  const walletBump = await db
    .prepare(
      `UPDATE game_open_claim_wallet_daily
       SET reserved_count = reserved_count + 1
       WHERE wallet = ? AND utc_day = ?
         AND reserved_count < ?`
    )
    .bind(wallet, utcDay, GAME_OPEN_CLAIM_PER_WALLET_DAILY)
    .run();
  if (!walletBump.meta?.changes) {
    await db
      .prepare(
        `DELETE FROM game_open_claims
         WHERE wallet = ? AND game_id = ? AND utc_day = ? AND status = 'pending'`
      )
      .bind(wallet, opts.gameId, utcDay)
      .run()
      .catch(() => {});
    throw new GameOpenClaimError(
      "Already reached today's per-wallet claim limit.",
      "WALLET_DAILY_CAP"
    );
  }

  const globalBump = await db
    .prepare(
      `UPDATE game_open_claim_daily
       SET claim_count = claim_count + 1
       WHERE utc_day = ? AND claim_count < ?`
    )
    .bind(utcDay, GAME_OPEN_CLAIM_DAILY_CAP)
    .run();
  if (!globalBump.meta?.changes) {
    await db
      .prepare(
        `DELETE FROM game_open_claims
         WHERE wallet = ? AND game_id = ? AND utc_day = ? AND status = 'pending'`
      )
      .bind(wallet, opts.gameId, utcDay)
      .run()
      .catch(() => {});
    await db
      .prepare(
        `UPDATE game_open_claim_wallet_daily
         SET reserved_count = CASE
           WHEN reserved_count > 0 THEN reserved_count - 1
           ELSE 0
         END
         WHERE wallet = ? AND utc_day = ?`
      )
      .bind(wallet, utcDay)
      .run()
      .catch(() => {});
    throw new GameOpenClaimError(
      "Already reached today's claim limit.",
      "DAILY_CAP"
    );
  }
}

async function reserveGameOpenClaimRtdb(
  wallet: string,
  utcDay: string,
  now: number,
  opts: {
    gameId: string;
    campaignId: number;
    nonce: number;
    signature: string;
    deadline: number;
  }
): Promise<void> {
  const path = claimPath(wallet, utcDay, opts.gameId);
  const existing = await readPath<GameOpenClaimRecord>(path);
  if (existing?.status === "claimed") {
    throw new GameOpenClaimError(
      "Already claimed today's open reward for this game.",
      "ALREADY_CLAIMED"
    );
  }
  if (existing?.status === "pending" || existing?.status === "paying") {
    await writePath(path, {
      ...existing,
      campaignId: opts.campaignId,
      status: "pending",
      nonce: opts.nonce,
    } satisfies GameOpenClaimRecord);
    return;
  }

  const pendingRecord: GameOpenClaimRecord = {
    wallet,
    gameId: opts.gameId,
    utcDay,
    campaignId: opts.campaignId,
    amountMicro: GAME_OPEN_CLAIM_AMOUNT_MICRO,
    status: "pending",
    claimTx: null,
    spinTx: null,
    nonce: opts.nonce,
    createdAt: now,
    claimedAt: null,
  };

  // Create the per-game row first so same-game races share one slot.
  const created = await runRtdbTransaction<GameOpenClaimRecord>(
    path,
    (current) => {
      if (current != null) return undefined;
      return pendingRecord;
    }
  );
  if (!created.committed) {
    const raced = await readPath<GameOpenClaimRecord>(path);
    if (raced?.status === "claimed") {
      throw new GameOpenClaimError(
        "Already claimed today's open reward for this game.",
        "ALREADY_CLAIMED"
      );
    }
    if (raced?.status === "pending" || raced?.status === "paying") return;
    throw new GameOpenClaimError(
      "Already reached today's claim limit.",
      "DAILY_CAP"
    );
  }

  const walletPath = walletDailyCountPath(wallet, utcDay);
  const walletTx = await runRtdbTransaction<number>(walletPath, (current) => {
    const n =
      typeof current === "number" && Number.isFinite(current) ? current : 0;
    if (n >= GAME_OPEN_CLAIM_PER_WALLET_DAILY) return undefined;
    return n + 1;
  });
  if (!walletTx.committed) {
    await deletePath(path).catch(() => {});
    throw new GameOpenClaimError(
      "Already reached today's per-wallet claim limit.",
      "WALLET_DAILY_CAP"
    );
  }

  const globalTx = await runRtdbTransaction<number>(
    dailyCountPath(utcDay),
    (current) => {
      const n =
        typeof current === "number" && Number.isFinite(current) ? current : 0;
      if (n >= GAME_OPEN_CLAIM_DAILY_CAP) return undefined;
      return n + 1;
    }
  );
  if (!globalTx.committed) {
    await deletePath(path).catch(() => {});
    await runRtdbTransaction<number>(walletPath, (current) => {
      const n =
        typeof current === "number" && Number.isFinite(current) ? current : 0;
      return Math.max(0, n - 1);
    }).catch(() => ({ committed: false, snapshot: null }));
    throw new GameOpenClaimError(
      "Already reached today's claim limit.",
      "DAILY_CAP"
    );
  }
}

export async function markGameOpenClaimed(opts: {
  walletAddress: string;
  gameId: string;
  campaignId: number;
  spinTx: string;
  claimTx?: string | null;
}): Promise<void> {
  const wallet = normalizeWalletAddress(opts.walletAddress);
  const utcDay = gameOpenClaimDayKey();
  const claimedAt = Date.now();
  dropStatusBatchCache(wallet);
  const spinTx = opts.spinTx.toLowerCase();
  const claimTx = opts.claimTx?.toLowerCase() ?? null;

  if (await useD1PlayerData()) {
    const db = await requireD1();
    const before = await db
      .prepare(
        `SELECT status FROM game_open_claims
         WHERE wallet = ? AND game_id = ? AND utc_day = ?`
      )
      .bind(wallet, opts.gameId, utcDay)
      .first<{ status: string }>();
    const alreadyReserved =
      before?.status === "pending" ||
      before?.status === "paying" ||
      before?.status === "claimed";

    // Legacy sync without a prior reserve: take the slot now.
    if (!alreadyReserved) {
      await reserveGameOpenClaim({
        walletAddress: wallet,
        gameId: opts.gameId,
        campaignId: opts.campaignId,
        nonce: 0,
        signature: "",
        deadline: 0,
      });
    }

    await db
      .prepare(
        `INSERT INTO game_open_claims
         (wallet, game_id, utc_day, campaign_id, amount_micro, status, claim_tx, created_at, claimed_at)
         VALUES (?, ?, ?, ?, ?, 'claimed', ?, ?, ?)
         ON CONFLICT(wallet, game_id, utc_day) DO UPDATE SET
           status = 'claimed',
           claim_tx = excluded.claim_tx,
           claimed_at = excluded.claimed_at,
           campaign_id = excluded.campaign_id`
      )
      .bind(
        wallet,
        opts.gameId,
        utcDay,
        opts.campaignId,
        GAME_OPEN_CLAIM_AMOUNT_MICRO,
        claimTx ?? spinTx,
        claimedAt,
        claimedAt
      )
      .run();
    return;
  }

  const path = claimPath(wallet, utcDay, opts.gameId);
  const existing = await readPath<GameOpenClaimRecord>(path);
  const alreadyReserved =
    existing?.status === "pending" ||
    existing?.status === "paying" ||
    existing?.status === "claimed";
  if (!alreadyReserved) {
    await reserveGameOpenClaim({
      walletAddress: wallet,
      gameId: opts.gameId,
      campaignId: opts.campaignId,
      nonce: 0,
      signature: "",
      deadline: 0,
    });
  }
  const reserved = await readPath<GameOpenClaimRecord>(path);
  await writePath(path, {
    wallet,
    gameId: opts.gameId,
    utcDay,
    campaignId: opts.campaignId,
    amountMicro: GAME_OPEN_CLAIM_AMOUNT_MICRO,
    status: "claimed",
    claimTx: claimTx ?? spinTx,
    spinTx,
    createdAt: reserved?.createdAt ?? existing?.createdAt ?? claimedAt,
    claimedAt,
  } satisfies GameOpenClaimRecord);
}

export async function clearPendingGameOpenClaim(
  walletAddress: string,
  gameId: string
): Promise<void> {
  const wallet = normalizeWalletAddress(walletAddress);
  const utcDay = gameOpenClaimDayKey();
  dropStatusBatchCache(wallet);

  if (await useD1PlayerData()) {
    const db = await requireD1();
    const before = await db
      .prepare(
        `SELECT status FROM game_open_claims
         WHERE wallet = ? AND game_id = ? AND utc_day = ?`
      )
      .bind(wallet, gameId, utcDay)
      .first<{ status: string }>();
    if (before?.status !== "pending" && before?.status !== "paying") return;

    const deleted = await db
      .prepare(
        `DELETE FROM game_open_claims
         WHERE wallet = ? AND game_id = ? AND utc_day = ?
           AND status IN ('pending', 'paying')`
      )
      .bind(wallet, gameId, utcDay)
      .run()
      .catch(() => null);
    if (!deleted?.meta?.changes) return;

    await db
      .prepare(
        `UPDATE game_open_claim_wallet_daily
         SET reserved_count = CASE
           WHEN reserved_count > 0 THEN reserved_count - 1
           ELSE 0
         END
         WHERE wallet = ? AND utc_day = ?`
      )
      .bind(wallet, utcDay)
      .run()
      .catch(() => {});
    await db
      .prepare(
        `UPDATE game_open_claim_daily
         SET claim_count = CASE
           WHEN claim_count > 0 THEN claim_count - 1
           ELSE 0
         END
         WHERE utc_day = ?`
      )
      .bind(utcDay)
      .run()
      .catch(() => {});
    return;
  }

  const path = claimPath(wallet, utcDay, gameId);
  const existing = await readPath<GameOpenClaimRecord>(path);
  if (existing?.status !== "pending" && existing?.status !== "paying") return;
  await deletePath(path).catch(() => {});
  await runRtdbTransaction<number>(
    walletDailyCountPath(wallet, utcDay),
    (current) => {
      const n =
        typeof current === "number" && Number.isFinite(current) ? current : 0;
      return Math.max(0, n - 1);
    }
  ).catch(() => ({ committed: false, snapshot: null }));
  await runRtdbTransaction<number>(dailyCountPath(utcDay), (current) => {
    const n =
      typeof current === "number" && Number.isFinite(current) ? current : 0;
    return Math.max(0, n - 1);
  }).catch(() => ({ committed: false, snapshot: null }));
}
