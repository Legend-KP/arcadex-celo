/**
 * Option C: one ArcadeXRewards SHUFFLE campaign per live game.
 * Campaign IDs 7–19 for the current 13 live titles.
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

export const GAME_OPEN_CAMPAIGN_ID_MIN = 7;
export const GAME_OPEN_CAMPAIGN_ID_MAX = 19;

/**
 * Built-in map from name slug / common aliases → campaign id.
 * Keys are lowercase slugs (no spaces).
 */
export const DEFAULT_GAME_OPEN_CAMPAIGN_BY_SLUG: Record<string, number> = {
  // 7 Reflector
  reflector: 7,
  // 8 Guardian of Earth
  "guardian-of-earth": 8,
  "guardian-of-eath": 8,
  guardianofearth: 8,
  guardian: 8,
  goe: 8,
  // 9 Free Fall
  "free-fall": 9,
  freefall: 9,
  free: 9,
  // 10 Infinite (Infinite Spiral)
  infinite: 10,
  "infinite-spiral": 10,
  infinitespiral: 10,
  spiral: 10,
  // 11 Dot Connect
  "dot-connect": 11,
  dotconnect: 11,
  // 12 Coin (Coin Sort)
  coin: 12,
  "coin-sort": 12,
  coinsort: 12,
  "coin-spot": 12,
  coinspot: 12,
  // 13 BaseDrop
  basedrop: 13,
  "base-drop": 13,
  // 14 Orbit flow
  "orbit-flow": 14,
  orbitflow: 14,
  orbit: 14,
  // 15 Jelly Jumble
  "jelly-jumble": 15,
  jellyjumble: 15,
  jelly: 15,
  // 16 Hungry Hole ("Hunger Hoel")
  "hungry-hole": 16,
  hungryhole: 16,
  hungry: 16,
  hunger: 16,
  "hunger-hoel": 16,
  // 17 Fruit Swipe
  "fruit-swipe": 17,
  fruitswipe: 17,
  "fruit-game": 17,
  fruit: 17,
  // 18 Block Blast
  "block-blast": 18,
  blockblast: 18,
  // 19 Line Link
  "line-link": 19,
  linelink: 19,
};

/** Human-readable checklist (campaign → title). */
export const GAME_OPEN_CAMPAIGN_TITLES: Record<number, string> = {
  7: "Reflector",
  8: "Guardian of Earth",
  9: "Free Fall",
  10: "Infinite",
  11: "Dot Connect",
  12: "Coin",
  13: "BaseDrop",
  14: "Orbit flow",
  15: "Jelly Jumble",
  16: "Hungry Hole",
  17: "Fruit Swipe",
  18: "Block Blast",
  19: "Line Link",
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

/** Shared setCampaign economics for every per-game open campaign. */
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
  maxSinglePayout: 5000,
} as const;
