import {
  createPublicClient,
  formatUnits,
  http,
  type Address,
  type Hash,
} from "viem";
import { celo } from "viem/chains";
import { createMiniPayWalletClient } from "@/lib/minipay";
import {
  CELO_USDC_ADDRESS,
  CELO_USDT_ADDRESS,
  ERC20_ABI,
  SPARK_REFILL_ABI,
  SPARK_REFILL_CONTRACT_ADDRESS,
  type SparkRefillPaymentToken,
  STABLECOIN_DECIMALS,
  tokenAddress,
  tokenFeeCurrency,
} from "@/lib/spark-refill";

const publicClient = createPublicClient({
  chain: celo,
  transport: http("https://forno.celo.org"),
});

async function readBalance(token: Address, account: Address): Promise<bigint> {
  return publicClient.readContract({
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

export async function purchaseSparkRefillOnChain(): Promise<{
  txHash: Hash;
  token: SparkRefillPaymentToken;
}> {
  const walletClient = createMiniPayWalletClient();
  if (!walletClient) {
    throw new Error("Connect your wallet in MiniPay to purchase Spark Refill.");
  }

  const [account] = await walletClient.getAddresses();
  if (!account) {
    throw new Error("No wallet account available.");
  }

  const fee = await publicClient.readContract({
    address: SPARK_REFILL_CONTRACT_ADDRESS,
    abi: SPARK_REFILL_ABI,
    functionName: "fee",
  });

  const token = await pickPaymentToken(account, fee);
  const tokenAddr = tokenAddress(token);
  const feeCurrency = tokenFeeCurrency(token);

  const allowance = await publicClient.readContract({
    address: tokenAddr,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account, SPARK_REFILL_CONTRACT_ADDRESS],
  });

  if (allowance < fee) {
    const approveHash = await walletClient.writeContract({
      account,
      chain: celo,
      address: tokenAddr,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [SPARK_REFILL_CONTRACT_ADDRESS, fee],
      feeCurrency,
    });

    const approveReceipt = await publicClient.waitForTransactionReceipt({
      hash: approveHash,
    });

    if (approveReceipt.status !== "success") {
      throw new Error("Token approval failed.");
    }
  }

  const payHash = await walletClient.writeContract({
    account,
    chain: celo,
    address: SPARK_REFILL_CONTRACT_ADDRESS,
    abi: SPARK_REFILL_ABI,
    functionName: token === "USDT" ? "payWithUSDT" : "payWithUSDC",
    feeCurrency,
  });

  const payReceipt = await publicClient.waitForTransactionReceipt({
    hash: payHash,
  });

  if (payReceipt.status !== "success") {
    throw new Error("Spark Refill payment failed.");
  }

  return { txHash: payHash, token };
}
