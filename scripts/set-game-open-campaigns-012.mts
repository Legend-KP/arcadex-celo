/**
 * Create ArcadeXRewards SHUFFLE campaigns 20–32 at $0.012 USDT
 * (maxSinglePayout = 12000). Optionally deactivate legacy 7–19.
 *
 * Usage (owner key required):
 *   ARCADEX_REWARDS_OWNER_PRIVATE_KEY=0x... node ./node_modules/tsx/dist/cli.mjs scripts/set-game-open-campaigns-012.mts
 *   ARCADEX_REWARDS_OWNER_PRIVATE_KEY=0x... DEACTIVATE_LEGACY=1 node ./node_modules/tsx/dist/cli.mjs scripts/set-game-open-campaigns-012.mts
 *
 * Dry-run (no txs): omit the private key.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import {
  ARCADEX_REWARDS_ABI,
  ARCADEX_REWARDS_CONTRACT_ADDRESS,
} from "../lib/arcadex-rewards.ts";
import {
  GAME_OPEN_CAMPAIGN_TITLES,
  GAME_OPEN_SET_CAMPAIGN_TEMPLATE as T,
} from "../lib/game-open-campaigns.ts";

const CONTRACT =
  (process.env.NEXT_PUBLIC_ARCADEX_REWARDS_CONTRACT?.trim() as Address) ||
  (ARCADEX_REWARDS_CONTRACT_ADDRESS as Address);

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;

const publicClient = createPublicClient({
  chain: celo,
  transport: http("https://forno.celo.org", { timeout: 30_000 }),
});

async function setOne(
  write: (
    args: readonly [
      bigint,
      number,
      boolean,
      number,
      number,
      number,
      bigint,
      bigint,
      number,
      Address,
      bigint,
      Hex,
      boolean,
      boolean,
      bigint,
    ]
  ) => Promise<Hex>,
  campaignId: number,
  active: boolean,
  maxSinglePayout: bigint
) {
  const hash = await write([
    BigInt(campaignId),
    T.campaignType,
    active,
    T.requiredDays,
    T.minIntervalSeconds,
    T.maxClaims,
    BigInt(T.startTime),
    BigInt(T.endTime),
    T.rewardMode,
    ZERO,
    BigInt(T.rewardAmount),
    ZERO_BYTES32,
    T.resetAfterMilestone,
    T.requireEligibility,
    maxSinglePayout,
  ]);
  console.log(`  tx ${hash}`);
  await publicClient.waitForTransactionReceipt({ hash });
}

async function main() {
  const pk = process.env.ARCADEX_REWARDS_OWNER_PRIVATE_KEY?.trim();
  const deactivateLegacy = process.env.DEACTIVATE_LEGACY === "1";
  const newIds = Object.keys(GAME_OPEN_CAMPAIGN_TITLES)
    .map(Number)
    .sort((a, b) => a - b);

  console.log("contract", CONTRACT);
  console.log(
    "new campaigns",
    newIds.map((id) => `${id}=${GAME_OPEN_CAMPAIGN_TITLES[id]}`).join(", ")
  );
  console.log("maxSinglePayout", T.maxSinglePayout, "(0.012 USDT)");

  if (!pk) {
    console.log("\nDry-run only — set ARCADEX_REWARDS_OWNER_PRIVATE_KEY to send txs.");
    for (const id of newIds) {
      const [c, hasP] = await Promise.all([
        publicClient.readContract({
          address: CONTRACT,
          abi: ARCADEX_REWARDS_ABI,
          functionName: "getCampaign",
          args: [BigInt(id)],
        }),
        publicClient.readContract({
          address: CONTRACT,
          abi: ARCADEX_REWARDS_ABI,
          functionName: "hasParticipants",
          args: [BigInt(id)],
        }),
      ]);
      const row = c as readonly unknown[];
      console.log(
        JSON.stringify({
          id,
          title: GAME_OPEN_CAMPAIGN_TITLES[id],
          active: row[0],
          hasParticipants: hasP,
          maxSinglePayout: String(row[14]),
        })
      );
    }
    return;
  }

  const account = privateKeyToAccount(pk as Hex);
  const wallet = createWalletClient({
    account,
    chain: celo,
    transport: http("https://forno.celo.org", { timeout: 60_000 }),
  });
  console.log("owner", account.address);

  const write = async (
    args: readonly [
      bigint,
      number,
      boolean,
      number,
      number,
      number,
      bigint,
      bigint,
      number,
      Address,
      bigint,
      Hex,
      boolean,
      boolean,
      bigint,
    ]
  ) =>
    wallet.writeContract({
      address: CONTRACT,
      abi: ARCADEX_REWARDS_ABI,
      functionName: "setCampaign",
      args: [...args],
    });

  for (const id of newIds) {
    console.log(`setCampaign(${id}) ${GAME_OPEN_CAMPAIGN_TITLES[id]}…`);
    await setOne(write, id, true, BigInt(T.maxSinglePayout));
  }

  if (deactivateLegacy) {
    for (let id = 7; id <= 19; id++) {
      const existing = (await publicClient.readContract({
        address: CONTRACT,
        abi: ARCADEX_REWARDS_ABI,
        functionName: "getCampaign",
        args: [BigInt(id)],
      })) as readonly [
        boolean,
        boolean,
        boolean,
        number | bigint,
        number | bigint,
        number | bigint,
        number | bigint,
        bigint,
        bigint,
        number | bigint,
        Address,
        bigint,
        Hex,
        boolean,
        bigint,
      ];
      if (!existing[0]) {
        console.log(`legacy ${id} already inactive — skip`);
        continue;
      }
      console.log(`deactivate legacy setCampaign(${id})…`);
      // ParamsFrozen: must pass identical economics; only active/endTime may change.
      const hash = await write([
        BigInt(id),
        Number(existing[3]),
        false,
        Number(existing[4]),
        Number(existing[5]),
        Number(existing[6]),
        existing[7],
        existing[8],
        Number(existing[9]),
        existing[10],
        existing[11],
        existing[12],
        existing[13],
        existing[2],
        existing[14],
      ]);
      console.log(`  tx ${hash}`);
      await publicClient.waitForTransactionReceipt({ hash });
    }
  }

  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
