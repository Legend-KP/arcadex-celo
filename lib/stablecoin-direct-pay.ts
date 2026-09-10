import {
  encodeFunctionData,
  formatUnits,
  type Abi,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { celo } from "viem/chains";
import {
  formatChainError,
  getCeloPublicClient,
  readCeloContract,
  waitForCeloTransactionReceipt,
} from "@/lib/celo-public-client";
import {
  createMiniPayWalletClient,
  getInjectedProvider,
} from "@/lib/minipay";
import {
  CELO_USDC_ADDRESS,
  CELO_USDT_ADDRESS,
  ERC20_ABI,
  STABLECOIN_DECIMALS,
  tokenAddress,
  tokenFeeCurrency,
  type SparkRefillPaymentToken,
} from "@/lib/spark-refill";

/** ~$0.02 buffer so CIP-64 gas does not compete with the exact fee transfer. */
const GAS_BUFFER = BigInt(20_000);

async function readBalance(token: Address, account: Address): Promise<bigint> {
  return readCeloContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account],
  });
}

/**
 * Prefer a token with fee + gas buffer. MiniPay may still pay gas from either
 * stablecoin it holds; the buffer avoids exact-fee reverts.
 */
async function pickPaymentToken(
  account: Address,
  fee: bigint
): Promise<SparkRefillPaymentToken> {
  const [usdtBalance, usdcBalance] = await Promise.all([
    readBalance(CELO_USDT_ADDRESS, account),
    readBalance(CELO_USDC_ADDRESS, account),
  ]);

  const usdtOk = usdtBalance >= fee + GAS_BUFFER;
  const usdcOk = usdcBalance >= fee + GAS_BUFFER;
  const usdtExact = usdtBalance >= fee;
  const usdcExact = usdcBalance >= fee;

  if (usdtOk) return "USDT";
  if (usdcOk) return "USDC";

  // Exact fee only — allow if the *other* token can cover gas.
  if (usdtExact && usdcBalance > BigInt(0)) return "USDT";
  if (usdcExact && usdtBalance > BigInt(0)) return "USDC";

  if (usdtExact || usdcExact) {
    const needed = formatUnits(fee + GAS_BUFFER, STABLECOIN_DECIMALS);
    throw new Error(
      `Almost enough — keep about $${needed} in USDT/USDC so network fees are covered.`
    );
  }

  const needed = formatUnits(fee, STABLECOIN_DECIMALS);
  throw new Error(
    `Insufficient balance. You need $${needed} in USDT or USDC.`
  );
}

function toFriendlyError(error: unknown, fallback: string): Error {
  if (error instanceof Error) {
    const formatted = formatChainError(error);
    if (
      formatted &&
      formatted !== "Something went wrong. Please try again." &&
      formatted !== "Transaction failed. Please try again."
    ) {
      return new Error(formatted);
    }
    return error;
  }

  const message = formatChainError(error);
  if (message && message !== "Something went wrong. Please try again.") {
    return new Error(message);
  }
  return new Error(fallback);
}

function isUserRejection(error: unknown): boolean {
  const message = formatChainError(error).toLowerCase();
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? Number((error as { code: unknown }).code)
      : null;

  return (
    code === 4001 ||
    message.includes("cancelled") ||
    message.includes("canceled") ||
    message.includes("user rejected") ||
    message.includes("user denied") ||
    message.includes("rejected the request")
  );
}

function asTxHash(value: unknown): Hash | null {
  return typeof value === "string" && value.startsWith("0x") && value.length >= 66
    ? (value as Hash)
    : null;
}

/**
 * MiniPay-native send: eth_sendTransaction with encoded ERC-20 transfer.
 * Tries with feeCurrency, then without (MiniPay often picks gas token itself).
 */
async function sendMiniPayTokenTransfer(options: {
  account: Address;
  tokenAddr: Address;
  data: Hex;
  feeCurrency: Address;
}): Promise<Hash> {
  const provider = getInjectedProvider();
  if (!provider) {
    throw new Error("Open ArcadeX inside MiniPay to continue.");
  }

  const baseTx = {
    from: options.account,
    to: options.tokenAddr,
    data: options.data,
    value: "0x0" as const,
  };

  const attempts: Array<Record<string, string>> = [
    { ...baseTx, feeCurrency: options.feeCurrency },
    { ...baseTx },
  ];

  let lastError: unknown;

  for (const tx of attempts) {
    try {
      const txHash = await provider.request({
        method: "eth_sendTransaction",
        // MiniPay accepts feeCurrency on the tx object; EIP-1193 typings omit it.
        params: [tx as never],
      });
      const hash = asTxHash(txHash);
      if (hash) return hash;
      lastError = new Error("MiniPay did not return a transaction hash.");
    } catch (error) {
      lastError = error;
      if (isUserRejection(error)) {
        throw new Error("Payment cancelled in MiniPay.");
      }
    }
  }

  // Last resort: viem wallet client (MiniPay / wagmi docs pattern).
  const walletClient = createMiniPayWalletClient();
  if (!walletClient) {
    throw toFriendlyError(
      lastError,
      "MiniPay could not send the payment transaction."
    );
  }

  try {
    return await walletClient.sendTransaction({
      account: options.account,
      chain: celo,
      to: options.tokenAddr,
      data: options.data,
      feeCurrency: options.feeCurrency,
    });
  } catch (error) {
    throw toFriendlyError(
      error ?? lastError,
      "MiniPay could not send the payment transaction."
    );
  }
}

/**
 * One MiniPay confirmation: ERC-20 transfer of `fee()` into the payment contract.
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

  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [contractAddress, fee],
  });

  let payHash: Hash;
  try {
    payHash = await sendMiniPayTokenTransfer({
      account,
      tokenAddr,
      data,
      feeCurrency,
    });
  } catch (error) {
    if (isUserRejection(error)) {
      throw new Error("Payment cancelled in MiniPay.");
    }
    throw toFriendlyError(error, failError);
  }

  const payReceipt = await waitForCeloTransactionReceipt(payHash);

  if (payReceipt.status !== "success") {
    throw new Error(
      `${failError} The transfer was rejected on-chain. Check you have a little extra stablecoin for network fees.`
    );
  }

  return { txHash: payHash, token };
}
