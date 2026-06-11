export const HUMAN_VERIFY_ACTION = "human-verify";

import { getWorldAppPublicConfig } from "@/lib/world-app-config";

export function getPublicWorldAppId(): string {
  return getWorldAppPublicConfig().appId;
}

export function getServerWorldIdConfig() {
  const signingKey =
    process.env.WORLD_RP_SIGNING_KEY ?? process.env.RP_SIGNING_KEY ?? "";
  const rpId = process.env.WORLD_RP_ID ?? process.env.RP_ID ?? "";

  if (!signingKey || !rpId) {
    throw new Error(
      "World ID is not configured. Set WORLD_RP_SIGNING_KEY and WORLD_RP_ID."
    );
  }

  return { signingKey, rpId };
}
