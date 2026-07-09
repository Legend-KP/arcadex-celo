"use client";

import { purchaseScoreSubmitOnChain } from "@/lib/score-submit-purchase";
import { submitPaidScore } from "@/lib/leaderboard-client";

export async function executePaidScoreSubmit(
  gameId: string,
  payload: {
    walletAddress: string;
    playerName: string;
    score: number;
  }
): Promise<{ submitted: boolean; score: number; submittedBest: number }> {
  const { txHash } = await purchaseScoreSubmitOnChain();
  return submitPaidScore(gameId, {
    walletAddress: payload.walletAddress,
    txHash,
    playerName: payload.playerName,
    score: payload.score,
  });
}
