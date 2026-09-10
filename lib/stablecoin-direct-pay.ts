import {
  encodeFunctionData,
  formatUnits,
  type Abi,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import {
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
  CELO_USDC_FEE_CURRENCY,
  CELO_USDT_ADDRESS,
  CELO_USDT_FEE_CURRENCY,
  ERC20_ABI,
  STABLECOIN_DECIMALS,
  tokenAddress,
  type SparkRefillPaymentToken,
} from "@/lib/spark-refill";

/** ~$0.02 buffer so CIP-64 gas does not compete with the exact fee transfer. */
const GAS_BUFFER = BigInt(20_000);
/** MiniPay treats below this as dust and may ignore a requested feeCurrency. */
const FEE_CURRENCY_DUST = BigInt(1_000);

async function readBalance(token: Address, account: Address): Promise<bigint> {
  return readCeloContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account],
  });
}

function feeCurrencyFor(token: SparkRefillPaymentToken): Address {
  return token === "USDT" ? CELO_USDT_FEE_CURRENCY : CELO_USDC_FEE_CURRENCY;
}

/**
 * Pick which stablecoin to transfer, and which to use for gas.
 * Prefer paying gas with the *other* token so an exact-fee balance can still pay.
 */
async function pickPaymentAndGas(
  account: Address,
  fee: bigint
): Promise<{ token: SparkRefillPaymentToken; feeCurrency: Address }> {
  const [usdtBalance, usdcBalance] = await Promise.all([
    readBalance(CELO_USDT_ADDRESS, account),
    readBalance(CELO_USDC_ADDRESS, account),
  ]);

  const usdtCanPay = usdtBalance >= fee;
  const usdcCanPay = usdcBalance >= fee;

  if (!usdtCanPay && !usdcCanPay) {
    const needed = formatUnits(fee, STABLECOIN_DECIMALS);
    throw new Error(
      `Insufficient balance. You need $${needed} in USDT or USDC.`
    );
  }

  const usdtCanPayWithGas = usdtBalance >= fee + GAS_BUFFER;
  const usdcCanPayWithGas = usdcBalance >= fee + GAS_BUFFER;

  let token: SparkRefillPaymentToken;
  if (usdtCanPay && usdcBalance >= FEE_CURRENCY_DUST) {
    token = "USDT";
  } else if (usdcCanPay && usdtBalance >= FEE_CURRENCY_DUST) {
    token = "USDC";
  } else if (usdtCanPayWithGas) {
    token = "USDT";
  } else if (usdcCanPayWithGas) {
    token = "USDC";
  } else if (usdtCanPay) {
    token = "USDT";
  } else {
    token = "USDC";
  }

  const payBalance = token === "USDT" ? usdtBalance : usdcBalance;
  const otherBalance = token === "USDT" ? usdcBalance : usdtBalance;
  const otherToken: SparkRefillPaymentToken =
    token === "USDT" ? "USDC" : "USDT";

  let feeCurrency: Address;
  if (otherBalance >= FEE_CURRENCY_DUST) {
    feeCurrency = feeCurrencyFor(otherToken);
  } else if (payBalance >= fee + GAS_BUFFER) {
    feeCurrency = feeCurrencyFor(token);
  } else {
    const needed = formatUnits(fee + GAS_BUFFER, STABLECOIN_DECIMALS);
    throw new Error(
      `Almost enough — you need about $${needed} in ${token} (includes network fee), or a little USDT and USDC so gas can use the other token.`
    );
  }

  return { token, feeCurrency };
}

/**
 * Send via MiniPay's injected provider directly.
 * Avoids viem prepareTransactionRequest / gas estimation, which often fails
 * inside MiniPay before the pay sheet opens.
 */
async function sendMiniPayTokenTransfer(options: {
  account: Address;
  tokenAddress: Address;
  data: Hex;
  feeCurrency: Address;
}): Promise<Hash> {
  const provider = getInjectedProvider();
  if (!provider) {
    throw new Error("Open ArcadeX inside MiniPay to continue.");
  }

  const txHash = await provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: options.account,
        to: options.tokenAddress,
        data: options.data,
        value: "0x0",
        feeCurrency: options.feeCurrency,
      },
    ],
  });

  if (typeof txHash !== "string" || !txHash.startsWith("0x")) {
    throw new Error("MiniPay did not return a transaction hash.");
  }

  return txHash as Hash;
}

function isUserRejection(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "number"
      ? (error as { code: number }).code
      : null;

  return (
    code === 4001 ||
    message.includes("user rejected") ||
    message.includes("user denied") ||
    message.includes("rejected the request") ||
    message.includes("cancelled") ||
    message.includes("canceled")
  );
}

/**
 * One MiniPay confirmation: ERC-20 transfer of `fee()` into the payment contract.
 * Uses eth_sendTransaction + encoded transfer (MiniPay-recommended), not approve/payWith*.
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

  const { token, feeCurrency } = await pickPaymentAndGas(account, fee);
  const tokenAddr = tokenAddress(token);

  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [contractAddress, fee],
  });

  let payHash: Hash;
  try {
    payHash = await sendMiniPayTokenTransfer({
      account,
      tokenAddress: tokenAddr,
      data,
      feeCurrency,
    });
  } catch (error) {
    if (isUserRejection(error)) {
      throw new Error("Payment cancelled in MiniPay.");
    }
    throw error;
  }

  const payReceipt = await waitForCeloTransactionReceipt(payHash);

  if (payReceipt.status !== "success") {
    throw new Error(
      `${failError} The transfer was rejected on-chain. Check you have a little extra stablecoin for network fees.`
    );
  }

  return { txHash: payHash, token };
}
