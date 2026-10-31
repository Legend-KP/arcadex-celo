/**
 * Server store + status for per-game on-chain open claims (D1 or RTDB).
 */

import { useD1PlayerData, requireD1 } from "@/lib/d1-client";
import {
  GAME_OPEN_CLAIM_AMOUNT_MICRO,
  GAME_OPEN_CLAIM_DAILY_CAP,
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

let capTableReady = false;

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

/** Seed today's row from claims already stored, then leave later increments to markGameOpenClaimed. */
async function ensureDailyClaimRow(
  db: Awaited<ReturnType<typeof requireD1>>,
  utcDay: string
): Promise<void> {
  await ensureDailyCapTable(db);
  await db
    .prepare(
      `INSERT INTO game_open_claim_daily (utc_day, claim_count)
       SELECT ?, COUNT(*) FROM game_open_claims
       WHERE utc_day = ? AND status = 'claimed'
       ON CONFLICT(utc_day) DO NOTHING`
    )
    .bind(utcDay, utcDay)
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

async function incrementDailyClaimCount(utcDay: string): Promise<void> {
  if (await useD1PlayerData()) {
    const db = await requireD1();
    await ensureDailyClaimRow(db, utcDay);
    await db
      .prepare(
        `UPDATE game_open_claim_daily
         SET claim_count = claim_count + 1
         WHERE utc_day = ?`
      )
      .bind(utcDay)
      .run();
    return;
  }

  const current = await readDailyClaimCount(utcDay);
  await writePath(dailyCountPath(utcDay), current + 1);
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
    };
  }

  const wallet = normalizeWalletAddress(walletAddress);

  // App ledger first (fast).
  const ledgerClaimed = await isLedgerClaimed(wallet, gameId, utcDay);
  if (ledgerClaimed) {
    return {
      claimed: true,
      amountUsdt,
      campaignId,
      utcDay,
      payoutsEnabled: true,
      canClaim: false,
      claimsOpen,
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
      canClaim: claimsOpen && active && progress.canCheckIn,
      claimsOpen,
    };
  } catch {
    return {
      claimed: false,
      amountUsdt,
      campaignId,
      utcDay,
      payoutsEnabled: true,
      canClaim: claimsOpen,
      claimsOpen,
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

async function readLedgerClaimedGameIds(
  wallet: string,
  utcDay: string,
  gameIds: string[]
): Promise<Set<string>> {
  if (gameIds.length === 0) return new Set();

  if (await useD1PlayerData()) {
    const db = await requireD1();
    const placeholders = gameIds.map(() => "?").join(", ");
    const { results } = await db
      .prepare(
        `SELECT game_id FROM game_open_claims
         WHERE wallet = ? AND utc_day = ? AND status = 'claimed'
           AND game_id IN (${placeholders})`
      )
      .bind(wallet, utcDay, ...gameIds)
      .all<{ game_id: string }>();
    return new Set((results ?? []).map((row) => row.game_id));
  }

  const dayNode = await readPath<Record<string, GameOpenClaimRecord | null>>(
    `gameOpenClaims/${wallet.toLowerCase()}/${utcDay}`
  );
  const claimed = new Set<string>();
  if (!dayNode || typeof dayNode !== "object") return claimed;
  for (const id of gameIds) {
    if (dayNode[id]?.status === "claimed") claimed.add(id);
  }
  return claimed;
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
      };
    }
    const value = { utcDay, claimsOpen, byGameId };
    statusBatchCache.set(cacheKey, { at: Date.now(), value });
    return value;
  }

  const ledgerClaimed = await readLedgerClaimedGameIds(
    wallet,
    utcDay,
    withCampaign.map((game) => game.id)
  );
  const needsChain: { id: string; campaignId: number }[] = [];
  for (const game of withCampaign) {
    if (ledgerClaimed.has(game.id)) {
      byGameId[game.id] = {
        claimed: true,
        amountUsdt,
        campaignId: game.campaignId,
        utcDay,
        payoutsEnabled: true,
        canClaim: false,
        claimsOpen,
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
        canClaim: claimsOpen,
        claimsOpen,
      };
      continue;
    }
    byGameId[game.id] = {
      claimed: progress.claimed,
      amountUsdt,
      campaignId: game.campaignId,
      utcDay,
      payoutsEnabled: snap.payoutsEnabled,
      canClaim: claimsOpen && snap.payoutsEnabled && progress.canCheckIn,
      claimsOpen,
    };
  }

  const value = { utcDay, claimsOpen, byGameId };
  if (statusBatchCache.size > 200) {
    const now = Date.now();
    for (const [key, entry] of statusBatchCache) {
      if (now - entry.at >= STATUS_BATCH_CACHE_MS) statusBatchCache.delete(key);
    }
  }
  statusBatchCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

async function isLedgerClaimed(
  wallet: string,
  gameId: string,
  utcDay: string
): Promise<boolean> {
  if (await useD1PlayerData()) {
    const db = await requireD1();
    const row = await db
      .prepare(
        `SELECT status FROM game_open_claims
         WHERE wallet = ? AND game_id = ? AND utc_day = ?`
      )
      .bind(wallet, gameId, utcDay)
      .first<{ status: string }>();
    return row?.status === "claimed";
  }

  const existing = await readPath<GameOpenClaimRecord>(
    claimPath(wallet, utcDay, gameId)
  );
  return existing?.status === "claimed";
}

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

  if (await useD1PlayerData()) {
    const db = await requireD1();
    await db
      .prepare(
        `INSERT INTO game_open_claims
         (wallet, game_id, utc_day, campaign_id, amount_micro, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?)
         ON CONFLICT(wallet, game_id, utc_day) DO UPDATE SET
           campaign_id = excluded.campaign_id,
           status = CASE
             WHEN game_open_claims.status = 'claimed' THEN game_open_claims.status
             ELSE 'pending'
           END`
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
    return;
  }

  const path = claimPath(wallet, utcDay, opts.gameId);
  const existing = await readPath<GameOpenClaimRecord>(path);
  if (existing?.status === "claimed") return;
  await writePath(path, {
    wallet,
    gameId: opts.gameId,
    utcDay,
    campaignId: opts.campaignId,
    amountMicro: GAME_OPEN_CLAIM_AMOUNT_MICRO,
    status: "pending",
    claimTx: null,
    spinTx: null,
    nonce: opts.nonce,
    createdAt: existing?.createdAt ?? now,
    claimedAt: null,
  } satisfies GameOpenClaimRecord);
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
    const alreadyCounted = before?.status === "claimed";
    if (!alreadyCounted) await ensureDailyClaimRow(db, utcDay);
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
    if (!alreadyCounted) {
      await db
        .prepare(
          `UPDATE game_open_claim_daily
           SET claim_count = claim_count + 1
           WHERE utc_day = ?`
        )
        .bind(utcDay)
        .run();
    }
    return;
  }

  const path = claimPath(wallet, utcDay, opts.gameId);
  const existing = await readPath<GameOpenClaimRecord>(path);
  const alreadyCounted = existing?.status === "claimed";
  await writePath(path, {
    wallet,
    gameId: opts.gameId,
    utcDay,
    campaignId: opts.campaignId,
    amountMicro: GAME_OPEN_CLAIM_AMOUNT_MICRO,
    status: "claimed",
    claimTx: claimTx ?? spinTx,
    spinTx,
    createdAt: existing?.createdAt ?? claimedAt,
    claimedAt,
  } satisfies GameOpenClaimRecord);
  if (!alreadyCounted) await incrementDailyClaimCount(utcDay);
}

export async function clearPendingGameOpenClaim(
  walletAddress: string,
  gameId: string
): Promise<void> {
  const wallet = normalizeWalletAddress(walletAddress);
  const utcDay = gameOpenClaimDayKey();
  if (await useD1PlayerData()) {
    const db = await requireD1();
    await db
      .prepare(
        `DELETE FROM game_open_claims
         WHERE wallet = ? AND game_id = ? AND utc_day = ? AND status = 'pending'`
      )
      .bind(wallet, gameId, utcDay)
      .run()
      .catch(() => {});
    return;
  }
  const path = claimPath(wallet, utcDay, gameId);
  const existing = await readPath<GameOpenClaimRecord>(path);
  if (existing?.status === "pending") {
    await deletePath(path).catch(() => {});
  }
}
