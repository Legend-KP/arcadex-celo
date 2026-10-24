/**
 * Option C: one ArcadeXRewards SHUFFLE campaign per live game.
 * Campaign IDs 20–32 plus 35 (Knockout) and 36 (Retro Blocks) at $0.012 USDT.
 * Legacy 7–19 are frozen at $0.005 after participants (ParamsFrozen).
 *
 * Sync slug matching lives in game-open-campaign-ids.ts so client UI can
 * use it without pulling the server catalog.
 */

import {
  getCachedGameDoc,
  readSharedPublicCatalog,
} from "@/lib/game-cache";
import { fetchGameFromServer } from "@/lib/firestore-server";
import { matchGameOpenCampaignId } from "@/lib/game-open-campaign-ids";

export {
  GAME_OPEN_CAMPAIGN_ID_MIN,
  GAME_OPEN_CAMPAIGN_ID_MAX,
  DEFAULT_GAME_OPEN_CAMPAIGN_BY_SLUG,
  GAME_OPEN_CAMPAIGN_TITLES,
  getGameOpenCampaignMap,
  resolveGameOpenCampaignId,
  matchGameOpenCampaignId,
  listMappedGameOpenCampaigns,
} from "@/lib/game-open-campaign-ids";

/** Resolve campaign using catalog id + name (handles Firestore auto-ids). */
export async function resolveGameOpenCampaignIdForGame(
  gameId: string,
  gameNameHint?: string
): Promise<number | null> {
  const direct = matchGameOpenCampaignId(gameId, gameNameHint);
  if (direct != null) return direct;

  let game =
    getCachedGameDoc(gameId) ??
    (await fetchGameFromServer(gameId).catch(() => null));

  if (!game) {
    const catalog = await readSharedPublicCatalog();
    game = catalog?.games.find((g) => g.id === gameId) ?? null;
  }

  if (!game) return null;
  return matchGameOpenCampaignId(game.id, game.name);
}

/** Shared setCampaign economics for every per-game open campaign ($0.012 USDT). */
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
  maxSinglePayout: 12_000,
} as const;
