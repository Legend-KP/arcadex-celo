/**
 * Option C: one ArcadeXRewards SHUFFLE campaign per live game.
 * Campaign IDs 20–32 for the current 13 live titles ($0.12 USDT).
 * Legacy 7–19 are frozen at $0.005 after participants (ParamsFrozen).
 *
 * Resolution order:
 * 1. GAME_OPEN_CAMPAIGN_MAP env (gameId or slug → campaignId)
 * 2. Built-in slug / alias map below
 * 3. Match against catalog game name / id
 */

import { slugifyGameName } from "@/lib/game-assets";
import {
  getCachedGameDoc,
  readSharedPublicCatalog,
} from "@/lib/game-cache";
import { fetchGameFromServer } from "@/lib/firestore-server";

export const GAME_OPEN_CAMPAIGN_ID_MIN = 20;
export const GAME_OPEN_CAMPAIGN_ID_MAX = 32;

/**
 * Built-in map from name slug / common aliases → campaign id.
 * Keys are lowercase slugs (no spaces).
 */
export const DEFAULT_GAME_OPEN_CAMPAIGN_BY_SLUG: Record<string, number> = {
  // 20 Reflector (was 7)
  reflector: 20,
  // 21 Guardian of Earth (was 8)
  "guardian-of-earth": 21,
  "guardian-of-eath": 21,
  guardianofearth: 21,
  guardian: 21,
  goe: 21,
  // 22 Free Fall (was 9)
  "free-fall": 22,
  freefall: 22,
  free: 22,
  // 23 Infinite (Infinite Spiral) (was 10)
  infinite: 23,
  "infinite-spiral": 23,
  infinitespiral: 23,
  spiral: 23,
  // 24 Dot Connect (was 11)
  "dot-connect": 24,
  dotconnect: 24,
  // 25 Coin (Coin Sort) (was 12)
  coin: 25,
  "coin-sort": 25,
  coinsort: 25,
  "coin-spot": 25,
  coinspot: 25,
  // 26 BaseDrop (was 13)
  basedrop: 26,
  "base-drop": 26,
  // 27 Orbit flow (was 14)
  "orbit-flow": 27,
  orbitflow: 27,
  orbit: 27,
  // 28 Jelly Jumble (was 15)
  "jelly-jumble": 28,
  jellyjumble: 28,
  jelly: 28,
  // 29 Hungry Hole ("Hunger Hoel") (was 16)
  "hungry-hole": 29,
  hungryhole: 29,
  hungry: 29,
  hunger: 29,
  "hunger-hoel": 29,
  // 30 Fruit Swipe (was 17)
  "fruit-swipe": 30,
  fruitswipe: 30,
  "fruit-game": 30,
  fruit: 30,
  // 31 Block Blast (was 18)
  "block-blast": 31,
  blockblast: 31,
  // 32 Line Link (was 19)
  "line-link": 32,
  linelink: 32,
};

/** Human-readable checklist (campaign → title). */
export const GAME_OPEN_CAMPAIGN_TITLES: Record<number, string> = {
  20: "Reflector",
  21: "Guardian of Earth",
  22: "Free Fall",
  23: "Infinite",
  24: "Dot Connect",
  25: "Coin",
  26: "BaseDrop",
  27: "Orbit flow",
  28: "Jelly Jumble",
  29: "Hungry Hole",
  30: "Fruit Swipe",
  31: "Block Blast",
  32: "Line Link",
};

function parseCampaignMap(): Record<string, number> {
  const raw = process.env.GAME_OPEN_CAMPAIGN_MAP?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const id = key.trim().toLowerCase();
      const campaignId = typeof value === "number" ? value : Number(value);
      if (
        !id ||
        !Number.isFinite(campaignId) ||
        campaignId < GAME_OPEN_CAMPAIGN_ID_MIN ||
        campaignId > GAME_OPEN_CAMPAIGN_ID_MAX
      ) {
        continue;
      }
      out[id] = Math.floor(campaignId);
    }
    return out;
  } catch {
    return {};
  }
}

let cachedEnvMap: Record<string, number> | null = null;

export function getGameOpenCampaignMap(): Record<string, number> {
  if (!cachedEnvMap) cachedEnvMap = parseCampaignMap();
  return cachedEnvMap;
}

function lookupInMaps(key: string): number | null {
  const normalized = key.trim().toLowerCase();
  if (!normalized) return null;
  const envMap = getGameOpenCampaignMap();
  if (typeof envMap[normalized] === "number") return envMap[normalized];
  if (typeof DEFAULT_GAME_OPEN_CAMPAIGN_BY_SLUG[normalized] === "number") {
    return DEFAULT_GAME_OPEN_CAMPAIGN_BY_SLUG[normalized];
  }
  return null;
}

/**
 * Sync lookup by raw game id / slug only (no catalog fetch).
 * Prefer resolveGameOpenCampaignIdForGame when you have a catalog id.
 */
export function resolveGameOpenCampaignId(gameId: string): number | null {
  return lookupInMaps(gameId);
}

function campaignFromNameOrSlug(nameOrSlug: string): number | null {
  const nameSlug = slugifyGameName(nameOrSlug);
  const direct = lookupInMaps(nameSlug) ?? lookupInMaps(nameOrSlug);
  if (direct != null) return direct;

  // Prefer longer alias matches (free-fall before free).
  let best: { alias: string; campaignId: number } | null = null;
  for (const [alias, campaignId] of Object.entries(
    DEFAULT_GAME_OPEN_CAMPAIGN_BY_SLUG
  )) {
    if (
      nameSlug === alias ||
      nameSlug.includes(alias) ||
      alias.includes(nameSlug)
    ) {
      if (alias.length <= 3 && nameSlug !== alias) continue;
      if (!best || alias.length > best.alias.length) {
        best = { alias, campaignId };
      }
    }
  }
  return best?.campaignId ?? null;
}

/** Resolve campaign using catalog id + name (handles Firestore auto-ids). */
export async function resolveGameOpenCampaignIdForGame(
  gameId: string,
  gameNameHint?: string
): Promise<number | null> {
  const direct = lookupInMaps(gameId);
  if (direct != null) return direct;

  if (gameNameHint?.trim()) {
    const fromHint = campaignFromNameOrSlug(gameNameHint);
    if (fromHint != null) return fromHint;
  }

  let game =
    getCachedGameDoc(gameId) ??
    (await fetchGameFromServer(gameId).catch(() => null));

  if (!game) {
    const catalog = await readSharedPublicCatalog();
    game = catalog?.games.find((g) => g.id === gameId) ?? null;
  }

  if (!game) return null;

  const candidates = [
    game.id,
    slugifyGameName(game.name),
    game.name.trim().toLowerCase(),
  ].filter(Boolean);

  for (const key of candidates) {
    const hit = lookupInMaps(key);
    if (hit != null) return hit;
  }

  return campaignFromNameOrSlug(game.name);
}

export function listMappedGameOpenCampaigns(): Array<{
  gameId: string;
  campaignId: number;
}> {
  const merged = {
    ...DEFAULT_GAME_OPEN_CAMPAIGN_BY_SLUG,
    ...getGameOpenCampaignMap(),
  };
  return Object.entries(merged)
    .map(([gameId, campaignId]) => ({ gameId, campaignId }))
    .sort((a, b) => a.campaignId - b.campaignId || a.gameId.localeCompare(b.gameId));
}

/** Shared setCampaign economics for every per-game open campaign ($0.12 USDT). */
export const GAME_OPEN_SET_CAMPAIGN_TEMPLATE = {
  campaignType: 1 as const,
  active: true,
  requiredDays: 0,
  minIntervalSeconds: 86400,
  maxClaims: 0,
  startTime: 0,
  endTime: 0,
  rewardMode: 0,
  rewardTarget: "0x0000000000000000000000000000000000000000",
  rewardAmount: 0,
  rewardMeta:
    "0x0000000000000000000000000000000000000000000000000000000000000000",
  resetAfterMilestone: true,
  requireEligibility: false,
  maxSinglePayout: 120_000,
} as const;
