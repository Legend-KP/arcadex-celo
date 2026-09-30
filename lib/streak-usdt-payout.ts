import {
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  http,
  type Address,
  type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import {
  getCeloPublicClient,
  waitForCeloTransactionReceipt,
} from "@/lib/celo-public-client";
import { CELO_USDT_ADDRESS, STABLECOIN_DECIMALS } from "@/lib/spark-refill";
import {
  getStreakDailyUsdtBudget,
  getStreakUsdtPayoutPrivateKey,
  isStreakUsdtPayoutsEnabled,
} from "@/lib/streak-ladder-config";

export function usdtToMicro(amount: number): number {
  return Math.round(amount * 10 ** STABLECOIN_DECIMALS);
}

export function microToUsdt(micro: number): number {
  return micro / 10 ** STABLECOIN_DECIMALS;
}

export class StreakUsdtPayoutError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Transfer USDT from the streak payout hot wallet to the player.
 * Only used after entitlement + auth + idempotency checks upstream.
 */
export async function transferStreakUsdtToPlayer(
  player: Address,
  amountUsdt: number
): Promise<{ txHash: Hash; from: Address }> {
  if (!isStreakUsdtPayoutsEnabled()) {
    throw new StreakUsdtPayoutError(
      "Streak USDT payouts are disabled.",
      "PAYOUTS_DISABLED"
    );
  }

  const pk = getStreakUsdtPayoutPrivateKey();
  if (!pk) {
    throw new StreakUsdtPayoutError(
      "Streak USDT payout wallet is not configured.",
      "NO_PAYOUT_KEY"
    );
  }

  if (!(amountUsdt > 0) || !Number.isFinite(amountUsdt)) {
    throw new StreakUsdtPayoutError("Invalid USDT amount.", "BAD_AMOUNT");
  }

  const account = privateKeyToAccount(pk);
  const amount = BigInt(usdtToMicro(amountUsdt));
  const publicClient = getCeloPublicClient();

  const balance = await publicClient.readContract({
    address: CELO_USDT_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });

  if (balance < amount) {
    throw new StreakUsdtPayoutError(
      "Streak USDT treasury is empty. Try again later.",
      "INSUFFICIENT_TREASURY"
    );
  }

  const walletClient = createWalletClient({
    account,
    chain: celo,
    transport: http(
      process.env.NEXT_PUBLIC_CELO_RPC_URL?.trim() || "https://forno.celo.org"
    ),
  });

  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [player, amount],
  });

  const txHash = await walletClient.sendTransaction({
    to: CELO_USDT_ADDRESS,
    data,
    account,
    chain: celo,
  });

  const receipt = await waitForCeloTransactionReceipt(txHash, {
    timeoutMs: 60_000,
  });
  if (receipt.status !== "success") {
    throw new StreakUsdtPayoutError(
      "USDT transfer failed on-chain.",
      "TRANSFER_FAILED"
    );
  }

  return { txHash, from: account.address };
}

export { getStreakDailyUsdtBudget };
