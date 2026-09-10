import { formatUnits, type Abi, type Address, type Hash } from "viem";
import { celo } from "viem/chains";
import {
  getCeloPublicClient,
  readCeloContract,
  waitForCeloTransactionReceipt,
} from "@/lib/celo-public-client";
import { createMiniPayWalletClient } from "@/lib/minipay";
import {
  CELO_USDC_ADDRESS,
  CELO_USDT_ADDRESS,
  ERC20_ABI,
  STABLECOIN_DECIMALS,
  tokenAddress,
  tokenFeeCurrency,
  type SparkRefillPaymentToken,
} from "@/lib/spark-refill";

async function readBalance(token: Address, account: Address): Promise<bigint> {
  return readCeloContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account],
  });
}

async function pickPaymentToken(
  account: Address,
  fee: bigint
): Promise<SparkRefillPaymentToken> {
  const [usdtBalance, usdcBalance] = await Promise.all([
    readBalance(CELO_USDT_ADDRESS, account),
    readBalance(CELO_USDC_ADDRESS, account),
  ]);

  if (usdtBalance >= fee) return "USDT";
  if (usdcBalance >= fee) return "USDC";

  const needed = formatUnits(fee, STABLECOIN_DECIMALS);
  throw new Error(
    `Insufficient balance. You need $${needed} in USDT or USDC.`
  );
}

/**
 * One MiniPay confirmation: ERC-20 transfer of `fee()` into the payment contract.
 * Skips approve + payWith* so MiniPay never shows an approval popup.
 */
export async function purchaseStablecoinFeeOnChain(options: {
  contractAddress: Address;
  contractAbi: Abi;
  connectError: string;
  failError: string;
}): Promise<{ txHash: Hash; token: SparkRefillPaymentToken }> {
  const { contractAddress, contractAbi, connectError, failError } = options;

  const walletClient = createMiniPayWalletClient();
  if (!walletClient) {
    throw new Error(connectError);
  }

  const [account] = await walletClient.getAddresses();
  if (!account) {
    throw new Error("No wallet account available.");
  }

  const paused = (await getCeloPublicClient().readContract({
    address: contractAddress,
    abi: contractAbi,
    functionName: "paused",
  })) as boolean;
  if (paused) {
    throw new Error("Payments are paused. Please try again later.");
  }

  const fee = await readCeloContract({
    address: contractAddress,
    abi: contractAbi,
    functionName: "fee",
  });

  const token = await pickPaymentToken(account, fee);
  const tokenAddr = tokenAddress(token);
  const feeCurrency = tokenFeeCurrency(token);

  const payHash = await walletClient.writeContract({
    account,
    chain: celo,
    address: tokenAddr,
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [contractAddress, fee],
    feeCurrency,
  });

  const payReceipt = await waitForCeloTransactionReceipt(payHash);

  if (payReceipt.status !== "success") {
    throw new Error(failError);
  }

  return { txHash: payHash, token };
}
