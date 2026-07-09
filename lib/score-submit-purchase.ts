import { formatUnits, type Address, type Hash } from "viem";
import { celo } from "viem/chains";
import {
  getCeloPublicClient,
  readCeloContract,
} from "@/lib/celo-public-client";
import { createMiniPayWalletClient } from "@/lib/minipay";
import {
  CELO_USDC_ADDRESS,
  CELO_USDT_ADDRESS,
  ERC20_ABI,
  SCORE_SUBMIT_ABI,
  SCORE_SUBMIT_CONTRACT_ADDRESS,
  STABLECOIN_DECIMALS,
  tokenAddress,
  tokenFeeCurrency,
  type ScoreSubmitPaymentToken,
} from "@/lib/score-submit";

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
): Promise<ScoreSubmitPaymentToken> {
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

export async function purchaseScoreSubmitOnChain(): Promise<{
  txHash: Hash;
  token: ScoreSubmitPaymentToken;
}> {
  const walletClient = createMiniPayWalletClient();
  if (!walletClient) {
    throw new Error("Connect your wallet in MiniPay to submit your score.");
  }

  const [account] = await walletClient.getAddresses();
  if (!account) {
    throw new Error("No wallet account available.");
  }

  const fee = await readCeloContract({
    address: SCORE_SUBMIT_CONTRACT_ADDRESS,
    abi: SCORE_SUBMIT_ABI,
    functionName: "fee",
  });

  const token = await pickPaymentToken(account, fee);
  const tokenAddr = tokenAddress(token);
  const feeCurrency = tokenFeeCurrency(token);

  const allowance = await readCeloContract({
    address: tokenAddr,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account, SCORE_SUBMIT_CONTRACT_ADDRESS],
  });

  const publicClient = getCeloPublicClient();

  if (allowance < fee) {
    const approveHash = await walletClient.writeContract({
      account,
      chain: celo,
      address: tokenAddr,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [SCORE_SUBMIT_CONTRACT_ADDRESS, fee],
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
    address: SCORE_SUBMIT_CONTRACT_ADDRESS,
    abi: SCORE_SUBMIT_ABI,
    functionName: token === "USDT" ? "payWithUSDT" : "payWithUSDC",
    feeCurrency,
  });

  const payReceipt = await publicClient.waitForTransactionReceipt({
    hash: payHash,
  });

  if (payReceipt.status !== "success") {
    throw new Error("Score submission payment failed.");
  }

  return { txHash: payHash, token };
}
