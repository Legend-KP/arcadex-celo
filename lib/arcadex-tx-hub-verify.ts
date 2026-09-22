import {
  decodeEventLog,
  getAddress,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { getPaymentTransactionReceipt } from "@/lib/payment-tx-verify";
import {
  ARCADEX_TX_HUB_ABI,
  ARCADEX_TX_HUB_CONTRACT_ADDRESS,
  isArcadeXTxHubConfigured,
} from "@/lib/arcadex-tx-hub";

export interface VerifiedTxHubSignIn {
  player: Address;
  purpose: Hex;
  timestamp: bigint;
}

/**
 * Verify a MiniPay ArcadeXTxHub.signIn receipt for score publish (contest off).
 */
export async function verifyTxHubSignInTx(
  walletAddress: string,
  txHash: Hash,
  expectedPurpose: Hex
): Promise<VerifiedTxHubSignIn> {
  if (!isArcadeXTxHubConfigured()) {
    throw new Error("ArcadeXTxHub is not configured.");
  }

  const expectedPlayer = getAddress(walletAddress);
  const expectedPurposeNorm = expectedPurpose.toLowerCase();
  const receipt = await getPaymentTransactionReceipt(txHash);

  if (receipt.status !== "success") {
    throw new Error("Sign-in transaction did not succeed.");
  }

  if (
    receipt.to?.toLowerCase() !==
    ARCADEX_TX_HUB_CONTRACT_ADDRESS.toLowerCase()
  ) {
    throw new Error("Transaction was not sent to ArcadeXTxHub.");
  }

  let signedIn: VerifiedTxHubSignIn | null = null;

  for (const log of receipt.logs) {
    if (
      log.address.toLowerCase() !==
      ARCADEX_TX_HUB_CONTRACT_ADDRESS.toLowerCase()
    ) {
      continue;
    }

    try {
      const decoded = decodeEventLog({
        abi: ARCADEX_TX_HUB_ABI,
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName !== "SignedIn") continue;

      const args = decoded.args as {
        player: Address;
        purpose: Hex;
        timestamp: bigint;
      };

      if (getAddress(args.player) !== expectedPlayer) {
        throw new Error("Sign-in wallet does not match your account.");
      }
      if (args.purpose.toLowerCase() !== expectedPurposeNorm) {
        throw new Error("Sign-in purpose does not match score submit.");
      }

      signedIn = {
        player: getAddress(args.player),
        purpose: args.purpose,
        timestamp: args.timestamp,
      };
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes("does not match") ||
          err.message.includes("purpose does not match"))
      ) {
        throw err;
      }
    }
  }

  if (!signedIn) {
    throw new Error("No SignedIn event found in this transaction.");
  }

  return signedIn;
}
