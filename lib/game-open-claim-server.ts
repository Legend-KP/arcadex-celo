/**
 * Server store + status for per-game on-chain open claims (D1 or RTDB).
 */

import { useD1PlayerData, requireD1 } from "@/lib/d1-client";
import {
  GAME_OPEN_CLAIM_AMOUNT_MICRO,
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
import { CAMPAIGN_TYPE_SHUFFLE } from "@/lib/arcadex-rewards";

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
      | "PAYOUT_FAILED"
  ) {
    super(message);
    this.name = "GameOpenClaimError";
  }
}

function claimPath(wallet: string, utcDay: string, gameId: string): string {
  return `gameOpenClaims/${wallet.toLowerCase()}/${utcDay}/${gameId}`;
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
}> {
  const utcDay = gameOpenClaimDayKey();
  const amountUsdt = 0.005;
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
    };
  }

  if (!isWalletAddress(walletAddress)) {
    return {
      claimed: false,
      amountUsdt,
      campaignId,
      utcDay,
      payoutsEnabled: true,
      canClaim: true,
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
      canClaim: active && progress.canCheckIn,
    };
  } catch {
    return {
      claimed: false,
      amountUsdt,
      campaignId,
      utcDay,
      payoutsEnabled: true,
      canClaim: true,
    };
  }
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
  const spinTx = opts.spinTx.toLowerCase();
  const claimTx = opts.claimTx?.toLowerCase() ?? null;

  if (await useD1PlayerData()) {
    const db = await requireD1();
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
