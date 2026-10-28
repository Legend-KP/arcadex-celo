/**
 * Client-safe $0.012 open-claim campaign ids.
 * Slug map + sync matching only — no catalog or server imports.
 *
 * Resolution order:
 * 1. GAME_OPEN_CAMPAIGN_MAP env (gameId or slug → campaignId)
 * 2. Built-in slug / alias map below
 * 3. Match against the catalog game name
 */

import { slugifyGameName } from "@/lib/game-assets";

export const GAME_OPEN_CAMPAIGN_ID_MIN = 20;
export const GAME_OPEN_CAMPAIGN_ID_MAX = 40;

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
  // 35 Knockout
  knockout: 35,
  "knock-out": 35,
  "knockout-game": 35,
  // 36 Retro Blocks
  "retro-blocks": 36,
  retroblocks: 36,
  "retro-block": 36,
  retroblock: 36,
  // 37 Zeno
  zeno: 37,
  // 38 2048
  "2048": 38,
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
  35: "Knockout",
  36: "Retro Blocks",
  37: "Zeno",
  38: "2048",
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

/**
 * Campaign for a catalog game, using its id and display name.
 * Safe to call from client components.
 */
export function matchGameOpenCampaignId(
  gameId: string,
  gameName?: string
): number | null {
  const direct = lookupInMaps(gameId);
  if (direct != null) return direct;
  if (gameName?.trim()) return campaignFromNameOrSlug(gameName);
  return null;
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
