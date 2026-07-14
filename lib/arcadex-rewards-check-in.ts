"use client";

import type { Hash, Hex } from "viem";
import { celo } from "viem/chains";
import { getCeloPublicClient } from "@/lib/celo-public-client";
import { createMiniPayWalletClient } from "@/lib/minipay";
import {
  ARCADEX_REWARDS_ABI,
  ARCADEX_REWARDS_CONTRACT_ADDRESS,
  DEFAULT_STREAK_CAMPAIGN_ID,
  isArcadeXRewardsConfigured,
} from "@/lib/arcadex-rewards";

export async function checkInOnChain(
  campaignId: number = DEFAULT_STREAK_CAMPAIGN_ID,
  opts?: { deadline?: bigint; signature?: Hex }
): Promise<{ txHash: Hash }> {
  if (!isArcadeXRewardsConfigured()) {
    throw new Error("ArcadeXRewards is not configured yet.");
  }

  const walletClient = createMiniPayWalletClient();
  if (!walletClient) {
    throw new Error("Open ArcadeX inside MiniPay to check in.");
  }

  const [account] = await walletClient.getAddresses();
  if (!account) {
    throw new Error("No wallet account available.");
  }

  // Campaigns without requireEligibility ignore these (pass 0 / 0x).
  const deadline = opts?.deadline ?? 0n;
  const signature = opts?.signature ?? ("0x" as Hex);

  const hash = await walletClient.writeContract({
    account,
    chain: celo,
    address: ARCADEX_REWARDS_CONTRACT_ADDRESS,
    abi: ARCADEX_REWARDS_ABI,
    functionName: "checkIn",
    args: [BigInt(campaignId), deadline, signature],
  });

  const publicClient = getCeloPublicClient();
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status !== "success") {
    throw new Error("Check-in transaction failed.");
  }

  return { txHash: hash };
}
