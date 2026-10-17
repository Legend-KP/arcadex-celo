/**
 * Read ArcadeXRewards game-open campaigns 7–32 (Celo mainnet).
 * Usage: node ./node_modules/tsx/dist/cli.mjs scripts/check-game-open-campaigns.mts
 */
import { createPublicClient, http, type Address } from "viem";
import { celo } from "viem/chains";
import {
  ARCADEX_REWARDS_ABI,
  ARCADEX_REWARDS_CONTRACT_ADDRESS,
} from "../lib/arcadex-rewards.ts";

const CONTRACT =
  (process.env.NEXT_PUBLIC_ARCADEX_REWARDS_CONTRACT?.trim() as Address) ||
  (ARCADEX_REWARDS_CONTRACT_ADDRESS as Address);

const client = createPublicClient({
  chain: celo,
  transport: http("https://forno.celo.org", { timeout: 20_000 }),
});

async function main() {
  console.log("contract", CONTRACT);
  for (let id = 7; id <= 32; id++) {
    const [campaign, hasP] = await Promise.all([
      client.readContract({
        address: CONTRACT,
        abi: ARCADEX_REWARDS_ABI,
        functionName: "getCampaign",
        args: [BigInt(id)],
      }),
      client.readContract({
        address: CONTRACT,
        abi: ARCADEX_REWARDS_ABI,
        functionName: "hasParticipants",
        args: [BigInt(id)],
      }),
    ]);
    const row = campaign as readonly unknown[];
    console.log(
      JSON.stringify({
        id,
        active: row[0],
        cancelled: row[1],
        hasParticipants: hasP,
        maxSinglePayout: String(row[14]),
      })
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
