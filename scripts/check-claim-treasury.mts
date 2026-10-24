/**
 * Read ArcadeXRewards pause flag, USDT availability, and spin signer.
 * Usage: node ./node_modules/tsx/dist/cli.mjs scripts/check-claim-treasury.mts
 */
import { createPublicClient, http, type Address } from "viem";
import { celo } from "viem/chains";
import {
  ARCADEX_REWARDS_ABI,
  ARCADEX_REWARDS_CONTRACT_ADDRESS,
} from "../lib/arcadex-rewards.ts";

const CONTRACT = ARCADEX_REWARDS_CONTRACT_ADDRESS as Address;
const USDT = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e" as Address;

const client = createPublicClient({
  chain: celo,
  transport: http("https://forno.celo.org", { timeout: 20_000 }),
});

async function main() {
  const [paused, available, reserved, signer, usdtBal] = await Promise.all([
    client.readContract({
      address: CONTRACT,
      abi: ARCADEX_REWARDS_ABI,
      functionName: "paused",
    }),
    client.readContract({
      address: CONTRACT,
      abi: ARCADEX_REWARDS_ABI,
      functionName: "availableUSDT",
    }),
    client.readContract({
      address: CONTRACT,
      abi: ARCADEX_REWARDS_ABI,
      functionName: "reservedUSDT",
    }),
    client.readContract({
      address: CONTRACT,
      abi: ARCADEX_REWARDS_ABI,
      functionName: "spinResultSigner",
    }),
    client.readContract({
      address: USDT,
      abi: [
        {
          type: "function",
          name: "balanceOf",
          stateMutability: "view",
          inputs: [{ name: "account", type: "address" }],
          outputs: [{ name: "", type: "uint256" }],
        },
      ],
      functionName: "balanceOf",
      args: [CONTRACT],
    }),
  ]);

  const availableN = BigInt(available as bigint);
  const reservedN = BigInt(reserved as bigint);
  const balanceN = BigInt(usdtBal as bigint);
  console.log(
    JSON.stringify(
      {
        paused,
        spinResultSigner: signer,
        usdtBalance: balanceN.toString(),
        usdtBalanceHuman: Number(balanceN) / 1e6,
        reservedUSDT: reservedN.toString(),
        reservedHuman: Number(reservedN) / 1e6,
        availableUSDT: availableN.toString(),
        availableHuman: Number(availableN) / 1e6,
        canCover0012: availableN >= 12_000n,
        claimsLeftAt0012: Number(availableN / 12_000n),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
