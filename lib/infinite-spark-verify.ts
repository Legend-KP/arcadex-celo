import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  type Address,
  type Hash,
} from "viem";
import { celo } from "viem/chains";
import {
  CELO_USDC_ADDRESS,
  CELO_USDT_ADDRESS,
  INFINITE_SPARK_ABI,
  INFINITE_SPARK_CONTRACT_ADDRESS,
  type InfiniteSparkPaymentToken,
} from "@/lib/infinite-spark";

const publicClient = createPublicClient({
  chain: celo,
  transport: http("https://forno.celo.org"),
});

export interface VerifiedInfiniteSparkPayment {
  player: Address;
  token: InfiniteSparkPaymentToken;
  amount: bigint;
}

export async function verifyInfiniteSparkPaymentTx(
  walletAddress: string,
  txHash: Hash
): Promise<VerifiedInfiniteSparkPayment> {
  const expectedPlayer = getAddress(walletAddress);

  const receipt = await publicClient.getTransactionReceipt({ hash: txHash });

  if (receipt.status !== "success") {
    throw new Error("Transaction did not succeed.");
  }

  if (
    receipt.to?.toLowerCase() !== INFINITE_SPARK_CONTRACT_ADDRESS.toLowerCase()
  ) {
    throw new Error("Transaction was not sent to InfiniteSpark.");
  }

  const feeAtBlock = await publicClient.readContract({
    address: INFINITE_SPARK_CONTRACT_ADDRESS,
    abi: INFINITE_SPARK_ABI,
    functionName: "fee",
    blockNumber: receipt.blockNumber,
  });

  for (const log of receipt.logs) {
    if (
      log.address.toLowerCase() !== INFINITE_SPARK_CONTRACT_ADDRESS.toLowerCase()
    ) {
      continue;
    }

    try {
      const decoded = decodeEventLog({
        abi: INFINITE_SPARK_ABI,
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName !== "EntryPaid") continue;

      const { player, token, amount } = decoded.args as {
        player: Address;
        token: Address;
        amount: bigint;
      };

      if (getAddress(player) !== expectedPlayer) {
        throw new Error("Payment wallet does not match your account.");
      }

      const tokenLower = token.toLowerCase();
      let paymentToken: InfiniteSparkPaymentToken | null = null;

      if (tokenLower === CELO_USDT_ADDRESS.toLowerCase()) {
        paymentToken = "USDT";
      } else if (tokenLower === CELO_USDC_ADDRESS.toLowerCase()) {
        paymentToken = "USDC";
      } else {
        throw new Error("Payment token is not USDT or USDC.");
      }

      if (amount < feeAtBlock) {
        throw new Error("Payment amount is below the contract fee.");
      }

      return { player: expectedPlayer, token: paymentToken, amount };
    } catch (error) {
      if (error instanceof Error && error.message.includes("Payment wallet")) {
        throw error;
      }
      if (error instanceof Error && error.message.includes("Payment token")) {
        throw error;
      }
      if (error instanceof Error && error.message.includes("Payment amount")) {
        throw error;
      }
    }
  }

  throw new Error("EntryPaid event not found in transaction.");
}
