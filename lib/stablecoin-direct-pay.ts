import { formatUnits, getAddress, type Abi, type Address, type Hash } from "viem";
import { celo } from "viem/chains";
import {
  formatChainError,
  getCeloFeeCurrencyGasPrice,
  getCeloTransactionCount,
  readCeloContract,
  readCeloContractValue,
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

/** ~$0.02 buffer so CIP-64 gas does not compete with the exact fee transfer. */
const GAS_BUFFER = BigInt(20_000);
/** Fixed gas limit — skips MiniPay eth_estimateGas (often "unknown RPC error"). */
const TRANSFER_GAS_LIMIT = BigInt(120_000);

async function readBalance(token: Address, account: Address): Promise<bigint> {
  return readCeloContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account],
  });
}

/**
 * Prefer a token with fee + gas buffer. If only exact fee is available, allow
 * it when the other stablecoin can cover MiniPay gas.
 */
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

function toFriendlyError(error: unknown, fallback: string): Error {
  if (isUserRejection(error)) {
    return new Error("Payment cancelled in MiniPay.");
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

/**
 * One MiniPay confirmation: ERC-20 `transfer(fee)` into the payment contract.
 *
 * gas + gasPrice + nonce are filled from public Celo RPCs so MiniPay's
 * provider is only asked to sign/send — not eth_estimateGas / eth_gasPrice.
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

  const paused = await readCeloContractValue<boolean>({
    address: contractAddress,
    abi: contractAbi,
    functionName: "paused",
  });
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
  const feeCurrency = getAddress(tokenFeeCurrency(token));
  const recipient = getAddress(contractAddress);

  const [gasPrice, nonce] = await Promise.all([
    getCeloFeeCurrencyGasPrice(feeCurrency),
    getCeloTransactionCount(account),
  ]);

  let payHash: Hash;
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
      // CIP-64: legacy gasPrice in the fee-currency denomination (18 decimals).
      // Do not use maxFeePerGas — MiniPay rejects EIP-1559 fee fields.
      gasPrice,
      nonce,
    });
  } catch (error) {
    throw toFriendlyError(
      error,
      `${failError} MiniPay could not open the payment sheet.`
    );
  }

  const payReceipt = await waitForCeloTransactionReceipt(payHash);

  if (payReceipt.status !== "success") {
    throw new Error(
      `${failError} The transfer was rejected on-chain. Keep a little extra USDT/USDC for network fees.`
    );
  }

  return { txHash: payHash, token };
}
