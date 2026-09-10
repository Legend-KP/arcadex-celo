import {
  encodeFunctionData,
  formatUnits,
  getAddress,
  toHex,
  type Abi,
  type Address,
  type Hash,
} from "viem";
import { celo } from "viem/chains";
import {
  formatChainError,
  getCeloFeeCurrencyGasPrice,
  getCeloTransactionCount,
  readCeloContract,
  readCeloContractValue,
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
/** Fixed gas limit — skips MiniPay eth_estimateGas (often "unknown RPC error"). */
const TRANSFER_GAS_LIMIT = BigInt(120_000);

/** TEMP: surface raw errors in MiniPay UI (no easy console on device). Remove after fix. */
const DEBUG_PAYMENTS = true;

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

  if (usdtBalance >= fee + GAS_BUFFER) return "USDT";
  if (usdcBalance >= fee + GAS_BUFFER) return "USDC";

  if (usdtBalance >= fee && usdcBalance > BigInt(0)) return "USDT";
  if (usdcBalance >= fee && usdtBalance > BigInt(0)) return "USDC";

  if (usdtBalance >= fee || usdcBalance >= fee) {
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

function serializeRawError(error: unknown): string {
  try {
    if (error instanceof Error) {
      return JSON.stringify(error, Object.getOwnPropertyNames(error));
    }
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function summarizeRawError(error: unknown): string {
  const raw = serializeRawError(error);
  const formatted = formatChainError(error);
  const combined = `${formatted} | ${raw}`;
  return combined.length > 280 ? `${combined.slice(0, 277)}...` : combined;
}

function logRawError(stage: string, error: unknown): void {
  console.error(`[pay:${stage}] RAW ERROR:`, error);
  console.error(`[pay:${stage}] RAW ERROR JSON:`, serializeRawError(error));
}

function toFriendlyError(
  error: unknown,
  fallback: string,
  stage?: string
): Error {
  if (isUserRejection(error)) {
    return new Error("Payment cancelled in MiniPay.");
  }

  if (DEBUG_PAYMENTS) {
    const label = stage ? `[${stage}] ` : "";
    return new Error(`${label}${summarizeRawError(error) || fallback}`);
  }

  const formatted = formatChainError(error);
  if (
    formatted &&
    formatted !== "Something went wrong. Please try again." &&
    !formatted.toLowerCase().includes("unknown rpc error")
  ) {
    return new Error(formatted);
  }

  if (error instanceof Error && error.message.trim()) {
    const cleaned = error.message
      .split("\n")[0]
      ?.replace(/\s*Version: viem.*$/i, "")
      .trim();
    if (cleaned && cleaned.length <= 160) return new Error(cleaned);
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

async function runStage<T>(stage: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    logRawError(stage, error);
    throw toFriendlyError(error, `Payment failed during ${stage}.`, stage);
  }
}

/**
 * Fully-prepared eth_sendTransaction — MiniPay only signs/sends.
 * Avoids viem prepareTransactionRequest hitting MiniPay for gas/price/nonce.
 */
async function sendViaMiniPayProvider(options: {
  account: Address;
  tokenAddr: Address;
  data: `0x${string}`;
  feeCurrency: Address;
  gasPrice: bigint;
  nonce: number;
}): Promise<Hash> {
  const provider = getInjectedProvider();
  if (!provider) {
    throw new Error("Open ArcadeX inside MiniPay to continue.");
  }

  const tx = {
    from: options.account,
    to: options.tokenAddr,
    data: options.data,
    value: "0x0",
    gas: toHex(TRANSFER_GAS_LIMIT),
    gasPrice: toHex(options.gasPrice),
    nonce: toHex(options.nonce),
    feeCurrency: options.feeCurrency,
  };

  const txHash = await provider.request({
    method: "eth_sendTransaction",
    params: [tx as never],
  });

  if (typeof txHash !== "string" || !txHash.startsWith("0x")) {
    throw new Error("MiniPay did not return a transaction hash.");
  }

  return txHash as Hash;
}

/**
 * One MiniPay confirmation: ERC-20 `transfer(fee)` into the payment contract.
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

  const [rawAccount] = await walletClient.getAddresses();
  if (!rawAccount) {
    throw new Error("No wallet account available.");
  }
  const account = getAddress(rawAccount);

  const paused = await runStage("paused", () =>
    readCeloContractValue<boolean>({
      address: contractAddress,
      abi: contractAbi,
      functionName: "paused",
    })
  );
  if (paused) {
    throw new Error("Payments are paused. Please try again later.");
  }

  const fee = await runStage("fee", () =>
    readCeloContract({
      address: contractAddress,
      abi: contractAbi,
      functionName: "fee",
    })
  );

  const token = await runStage("balance", () =>
    pickPaymentToken(account, fee)
  );
  const tokenAddr = tokenAddress(token);
  const feeCurrency = getAddress(tokenFeeCurrency(token));
  const recipient = getAddress(contractAddress);

  const gasPrice = await runStage("gasPrice", () =>
    getCeloFeeCurrencyGasPrice(feeCurrency)
  );
  const nonce = await runStage("nonce", () =>
    getCeloTransactionCount(account)
  );

  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [recipient, fee],
  });

  if (DEBUG_PAYMENTS) {
    console.info("[pay:prepare]", {
      account,
      token,
      tokenAddr,
      recipient,
      fee: fee.toString(),
      feeCurrency,
      gas: TRANSFER_GAS_LIMIT.toString(),
      gasPrice: gasPrice.toString(),
      nonce,
    });
  }

  let payHash: Hash;
  let providerError: unknown;

  try {
    payHash = await sendViaMiniPayProvider({
      account,
      tokenAddr,
      data,
      feeCurrency,
      gasPrice,
      nonce,
    });
  } catch (error) {
    providerError = error;
    logRawError("eth_sendTransaction", error);
    if (isUserRejection(error)) {
      throw new Error("Payment cancelled in MiniPay.");
    }

    // Fallback: viem writeContract with the same pre-filled fields.
    try {
      payHash = await walletClient.writeContract({
        account,
        chain: celo,
        address: tokenAddr,
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [recipient, fee],
        feeCurrency,
        gas: TRANSFER_GAS_LIMIT,
        gasPrice,
        nonce,
      });
    } catch (writeError) {
      logRawError("writeContract", writeError);
      throw toFriendlyError(
        writeError ?? providerError,
        `${failError} MiniPay could not open the payment sheet.`,
        "writeContract"
      );
    }
  }

  const payReceipt = await runStage("receipt", () =>
    waitForCeloTransactionReceipt(payHash)
  );

  if (payReceipt.status !== "success") {
    throw new Error(
      `${failError} The transfer was rejected on-chain. Keep a little extra USDT/USDC for network fees.`
    );
  }

  return { txHash: payHash, token };
}
