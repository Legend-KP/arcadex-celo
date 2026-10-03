/**
 * Read ArcadeXRewards campaigns 4–6 + spinResultSigner (Celo mainnet).
 * Usage: node --import tsx scripts/check-daily-xp-campaign.mts
 * or: npx tsx scripts/check-daily-xp-campaign.mts
 */
import { createPublicClient, http, type Address } from "viem";
import { celo } from "viem/chains";
import {
  ARCADEX_REWARDS_ABI,
  ARCADEX_REWARDS_CONTRACT_ADDRESS,
} from "../lib/arcadex-rewards.ts";

const CONTRACT =
  (process.env.NEXT_PUBLIC_ARCADEX_REWARDS_CONTRACT?.trim() as Address) ||
  (ARCADEX_REWARDS_CONTRACT_ADDRESS as Address) ||
  ("0xc5BE4773D5B4a8e3C6f3E7a4C5f7cfBC38986ccF" as Address);

const client = createPublicClient({
  chain: celo,
  transport: http("https://forno.celo.org"),
});

async function readCampaign(id: number) {
  const campaign = await client.readContract({
    address: CONTRACT,
    abi: ARCADEX_REWARDS_ABI,
    functionName: "getCampaign",
    args: [BigInt(id)],
  });
  const [
    active,
    cancelled,
    requireEligibility,
    campaignType,
    requiredDays,
    minIntervalSeconds,
    maxClaims,
    startTime,
    endTime,
    rewardMode,
    rewardTarget,
    rewardAmount,
    rewardMeta,
    resetAfterMilestone,
    maxSinglePayout,
  ] = campaign as readonly [
    boolean,
    boolean,
    boolean,
    number | bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    number | bigint,
    Address,
    bigint,
    `0x${string}`,
    boolean,
    bigint,
  ];

  return {
    id,
    active,
    cancelled,
    requireEligibility,
    campaignType: Number(campaignType),
    campaignTypeLabel: Number(campaignType) === 1 ? "SHUFFLE" : "STREAK",
    requiredDays: Number(requiredDays),
    minIntervalSeconds: Number(minIntervalSeconds),
    maxClaims: Number(maxClaims),
    startTime: Number(startTime),
    endTime: Number(endTime),
    rewardMode: Number(rewardMode),
    rewardTarget,
    rewardAmount: rewardAmount.toString(),
    rewardMeta,
    resetAfterMilestone,
    maxSinglePayout: maxSinglePayout.toString(),
  };
}

async function main() {
  console.log("Contract:", CONTRACT);

  const signer = await client.readContract({
    address: CONTRACT,
    abi: ARCADEX_REWARDS_ABI,
    functionName: "spinResultSigner",
  });
  console.log("spinResultSigner:", signer);

  for (const id of [4, 5, 6]) {
    try {
      const c = await readCampaign(id);
      console.log(`\nCampaign ${id}:`, JSON.stringify(c, null, 2));
      if (id === 6) {
        const ok =
          c.active &&
          !c.cancelled &&
          c.campaignType === 1 &&
          c.minIntervalSeconds === 86400 &&
          c.maxClaims === 0 &&
          c.resetAfterMilestone === true &&
          c.requireEligibility === false &&
          c.maxSinglePayout === "50000";
        console.log(
          ok
            ? "\n✅ Campaign 6 matches Daily XP params."
            : "\n❌ Campaign 6 does NOT match expected Daily XP params."
        );
        if (!ok) {
          console.log("Expected: SHUFFLE(1), active, minInterval=86400, maxClaims=0, resetAfterMilestone=true, requireEligibility=false, maxSinglePayout=50000");
        }
        if (
          !signer ||
          String(signer).toLowerCase() ===
            "0x0000000000000000000000000000000000000000"
        ) {
          console.log("❌ spinResultSigner is zero — setSpinResultSigner required.");
        } else {
          console.log("✅ spinResultSigner is set.");
        }
      }
    } catch (err) {
      console.error(`Campaign ${id} read failed:`, err);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
