/**
 * D1 achievements: missions catalog + claimable XP.
 * No KV. Reads on Achievements open / claim only.
 */

import {
  isMissionMet,
  isMissionType,
  missionCurrentValue,
} from "@/lib/achievements";
import { requireD1, type D1DatabaseLike } from "@/lib/d1-client";
import {
  fetchGameProgressFromServer,
  storedProgressToGameProgress,
} from "@/lib/d1-server";
import {
  isWalletAddress,
  normalizeWalletAddress,
} from "@/lib/wallet-address";
import type {
  AchievementProgressItem,
  AchievementStatus,
  GameProgress,
  Mission,
  MissionType,
} from "@/types";

function progressFromStored(
  stored: Awaited<ReturnType<typeof fetchGameProgressFromServer>>
): GameProgress | null {
  if (!stored) return null;
  const asScore = storedProgressToGameProgress(stored, true);
  const asLevel = storedProgressToGameProgress(stored, false);
  return {
    ...(asScore.score !== undefined ? { score: asScore.score } : {}),
    ...(asLevel.level !== undefined ? { level: asLevel.level } : {}),
    ...(asLevel.modes || asScore.modes
      ? { modes: { ...(asScore.modes ?? {}), ...(asLevel.modes ?? {}) } }
      : {}),
  };
}

type MissionRow = {
  id: string;
  game_id: string;
  title: string;
  type: string;
  threshold: number;
  mode: string | null;
  xp_reward: number;
  active: number;
  sort_order: number;
  created_at: number;
  updated_at: number;
};

type ClaimRow = {
  mission_id: string;
  xp_granted: number;
  claimed_at: number;
};

function rowToMission(row: MissionRow): Mission {
  const type: MissionType = isMissionType(row.type) ? row.type : "score";
  return {
    id: row.id,
    gameId: row.game_id,
    title: row.title,
    type,
    threshold: row.threshold,
    mode: row.mode,
    xpReward: row.xp_reward,
    active: row.active === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function newMissionId(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function listMissionsFromD1(options?: {
  activeOnly?: boolean;
}): Promise<Mission[]> {
  const db = await requireD1();
  const activeOnly = options?.activeOnly !== false;
  const sql = activeOnly
    ? `SELECT * FROM missions WHERE active = 1 ORDER BY sort_order ASC, created_at ASC`
    : `SELECT * FROM missions ORDER BY sort_order ASC, created_at ASC`;
  const result = await db.prepare(sql).all<MissionRow>();
  return (result.results ?? []).map(rowToMission);
}

export async function getMissionFromD1(id: string): Promise<Mission | null> {
  const db = await requireD1();
  const row = await db
    .prepare(`SELECT * FROM missions WHERE id = ?`)
    .bind(id)
    .first<MissionRow>();
  return row ? rowToMission(row) : null;
}

export type CreateMissionInput = {
  gameId: string;
  title: string;
  type: MissionType;
  threshold: number;
  mode?: string | null;
  xpReward: number;
  active?: boolean;
  sortOrder?: number;
};

export async function createMissionOnD1(
  input: CreateMissionInput
): Promise<Mission> {
  if (!isMissionType(input.type)) {
    throw new Error("Mission type must be score or level.");
  }
  const gameId = input.gameId.trim();
  const title = input.title.trim();
  if (!gameId || !title) {
    throw new Error("Game and title are required.");
  }
  const threshold = Math.floor(input.threshold);
  const xpReward = Math.floor(input.xpReward);
  if (!Number.isFinite(threshold) || threshold <= 0) {
    throw new Error("Threshold must be a positive number.");
  }
  if (!Number.isFinite(xpReward) || xpReward <= 0) {
    throw new Error("XP reward must be a positive number.");
  }

  const now = Date.now();
  const id = newMissionId();
  const mode = input.mode?.trim() || null;
  const active = input.active === false ? 0 : 1;
  const sortOrder =
    typeof input.sortOrder === "number" && Number.isFinite(input.sortOrder)
      ? Math.floor(input.sortOrder)
      : 0;

  const db = await requireD1();
  await db
    .prepare(
      `INSERT INTO missions (
        id, game_id, title, type, threshold, mode, xp_reward,
        active, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      gameId,
      title,
      input.type,
      threshold,
      mode,
      xpReward,
      active,
      sortOrder,
      now,
      now
    )
    .run();

  return {
    id,
    gameId,
    title,
    type: input.type,
    threshold,
    mode,
    xpReward,
    active: active === 1,
    sortOrder,
    createdAt: now,
    updatedAt: now,
  };
}

export type UpdateMissionInput = Partial<{
  gameId: string;
  title: string;
  type: MissionType;
  threshold: number;
  mode: string | null;
  xpReward: number;
  active: boolean;
  sortOrder: number;
}>;

export async function updateMissionOnD1(
  id: string,
  patch: UpdateMissionInput
): Promise<Mission> {
  const existing = await getMissionFromD1(id);
  if (!existing) throw new Error("Mission not found.");

  const next: Mission = {
    ...existing,
    gameId:
      typeof patch.gameId === "string" && patch.gameId.trim()
        ? patch.gameId.trim()
        : existing.gameId,
    title:
      typeof patch.title === "string" && patch.title.trim()
        ? patch.title.trim()
        : existing.title,
    type: patch.type && isMissionType(patch.type) ? patch.type : existing.type,
    threshold:
      typeof patch.threshold === "number" && Number.isFinite(patch.threshold)
        ? Math.floor(patch.threshold)
        : existing.threshold,
    mode:
      patch.mode !== undefined
        ? patch.mode?.trim() || null
        : existing.mode ?? null,
    xpReward:
      typeof patch.xpReward === "number" && Number.isFinite(patch.xpReward)
        ? Math.floor(patch.xpReward)
        : existing.xpReward,
    active: typeof patch.active === "boolean" ? patch.active : existing.active,
    sortOrder:
      typeof patch.sortOrder === "number" && Number.isFinite(patch.sortOrder)
        ? Math.floor(patch.sortOrder)
        : existing.sortOrder,
    updatedAt: Date.now(),
  };

  if (next.threshold <= 0) throw new Error("Threshold must be a positive number.");
  if (next.xpReward <= 0) throw new Error("XP reward must be a positive number.");

  const db = await requireD1();
  await db
    .prepare(
      `UPDATE missions SET
        game_id = ?, title = ?, type = ?, threshold = ?, mode = ?,
        xp_reward = ?, active = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(
      next.gameId,
      next.title,
      next.type,
      next.threshold,
      next.mode,
      next.xpReward,
      next.active ? 1 : 0,
      next.sortOrder,
      next.updatedAt,
      id
    )
    .run();

  return next;
}

export async function deleteMissionOnD1(id: string): Promise<void> {
  const db = await requireD1();
  await db
    .prepare(`DELETE FROM achievement_claims WHERE mission_id = ?`)
    .bind(id)
    .run();
  await db.prepare(`DELETE FROM missions WHERE id = ?`).bind(id).run();
}

async function listClaimsForWallet(
  db: D1DatabaseLike,
  wallet: string
): Promise<Map<string, ClaimRow>> {
  const result = await db
    .prepare(
      `SELECT mission_id, xp_granted, claimed_at FROM achievement_claims WHERE wallet = ?`
    )
    .bind(wallet)
    .all<ClaimRow>();
  const map = new Map<string, ClaimRow>();
  for (const row of result.results ?? []) {
    map.set(row.mission_id, row);
  }
  return map;
}

async function fetchUserXp(db: D1DatabaseLike, wallet: string): Promise<number> {
  const row = await db
    .prepare(`SELECT xp FROM users WHERE wallet = ?`)
    .bind(wallet)
    .first<{ xp: number | null }>();
  const xp = row?.xp;
  return typeof xp === "number" && Number.isFinite(xp)
    ? Math.max(0, Math.floor(xp))
    : 0;
}

async function ensureUserRow(
  db: D1DatabaseLike,
  wallet: string
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO users (wallet, name, created_at, updated_at)
       VALUES (?, '', ?, ?)
       ON CONFLICT(wallet) DO NOTHING`
    )
    .bind(wallet, now, now)
    .run();
}

export async function getAchievementsForWallet(walletAddress: string): Promise<{
  xp: number;
  items: AchievementProgressItem[];
}> {
  if (!isWalletAddress(walletAddress)) {
    throw new Error("A valid wallet address is required.");
  }
  const wallet = normalizeWalletAddress(walletAddress);
  const db = await requireD1();

  const [missions, claims] = await Promise.all([
    listMissionsFromD1({ activeOnly: true }),
    listClaimsForWallet(db, wallet),
  ]);

  const gameIds = [...new Set(missions.map((m) => m.gameId))];
  const progressByGame = new Map<string, GameProgress | null>();

  await Promise.all(
    gameIds.map(async (gameId) => {
      try {
        const stored = await fetchGameProgressFromServer(wallet, gameId);
        progressByGame.set(gameId, progressFromStored(stored));
      } catch {
        progressByGame.set(gameId, null);
      }
    })
  );

  const items: AchievementProgressItem[] = missions.map((mission) => {
    const claimed = claims.has(mission.id);
    const progress = progressByGame.get(mission.gameId);
    const current = missionCurrentValue(mission, progress);
    let status: AchievementStatus = "in_progress";
    if (claimed) status = "claimed";
    else if (isMissionMet(mission, progress)) status = "claimable";

    return {
      mission,
      status,
      current,
      threshold: mission.threshold,
    };
  });

  const xp = await fetchUserXp(db, wallet);
  return { xp, items };
}

export async function claimAchievementOnD1(
  walletAddress: string,
  missionId: string
): Promise<{
  xp: number;
  xpGranted: number;
  alreadyClaimed: boolean;
}> {
  if (!isWalletAddress(walletAddress)) {
    throw new Error("A valid wallet address is required.");
  }
  const wallet = normalizeWalletAddress(walletAddress);
  const id = missionId.trim();
  if (!id) throw new Error("Mission id is required.");

  const db = await requireD1();
  await ensureUserRow(db, wallet);

  const mission = await getMissionFromD1(id);
  if (!mission || !mission.active) {
    throw new Error("Mission not found or inactive.");
  }

  const existing = await db
    .prepare(
      `SELECT mission_id, xp_granted, claimed_at FROM achievement_claims WHERE wallet = ? AND mission_id = ?`
    )
    .bind(wallet, id)
    .first<ClaimRow>();

  if (existing) {
    return {
      xp: await fetchUserXp(db, wallet),
      xpGranted: existing.xp_granted,
      alreadyClaimed: true,
    };
  }

  const stored = await fetchGameProgressFromServer(wallet, mission.gameId);
  const progress = progressFromStored(stored);
  if (!isMissionMet(mission, progress)) {
    throw new Error(
      `Progress not met yet (${missionCurrentValue(mission, progress)} / ${mission.threshold}).`
    );
  }

  const now = Date.now();
  const xpReward = mission.xpReward;

  const insert = await db
    .prepare(
      `INSERT OR IGNORE INTO achievement_claims (wallet, mission_id, xp_granted, claimed_at)
       VALUES (?, ?, ?, ?)`
    )
    .bind(wallet, id, xpReward, now)
    .run();

  if (!insert.meta?.changes) {
    return {
      xp: await fetchUserXp(db, wallet),
      xpGranted: xpReward,
      alreadyClaimed: true,
    };
  }

  await db
    .prepare(
      `UPDATE users SET xp = COALESCE(xp, 0) + ?, updated_at = ? WHERE wallet = ?`
    )
    .bind(xpReward, now, wallet)
    .run();

  return {
    xp: await fetchUserXp(db, wallet),
    xpGranted: xpReward,
    alreadyClaimed: false,
  };
}
