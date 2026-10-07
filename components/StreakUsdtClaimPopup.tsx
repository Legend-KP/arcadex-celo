"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { formatChainError } from "@/lib/celo-public-client";
import { playSuccessSfx, playTouchSfx } from "@/lib/sfx";
import {
  claimStreakUsdt,
  fetchPendingStreakUsdt,
  type StreakUsdtPendingItem,
} from "@/lib/streak-client";
import { formatUsdtAmount } from "@/lib/streak-rewards";

type Props = {
  open: boolean;
  walletAddress: string;
  item: StreakUsdtPendingItem;
  /** `claimed: true` when the player finished a successful claim. */
  onClose: (result?: { claimed?: boolean }) => void;
};

/**
 * Standalone Claim popup for streak USDT (D7 / D14 / D21 / D30).
 * Kept outside the daily streak sheet so check-in UI stays clean.
 */
export default function StreakUsdtClaimPopup({
  open,
  walletAddress,
  item,
  onClose,
}: Props) {
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [claimedAmount, setClaimedAmount] = useState<number | null>(null);

  if (!open || typeof document === "undefined") return null;

  async function handleClaim() {
    playTouchSfx();
    setClaiming(true);
    setError("");
    try {
      let checkInTx = item.checkInTx?.trim() || "";
      if (!/^0x[a-fA-F0-9]{64}$/.test(checkInTx)) {
        const pending = await fetchPendingStreakUsdt(walletAddress);
        const match =
          pending.pending.find((row) => row.day === item.day) ?? null;
        if (!match?.checkInTx) {
          throw new Error("No pending streak USDT to claim.");
        }
        checkInTx = match.checkInTx;
      }

      const result = await claimStreakUsdt({
        walletAddress,
        checkInTx,
      });
      playSuccessSfx();
      setClaimedAmount(result.amountUsdt);
      setDone(true);
    } catch (err) {
      setError(formatChainError(err) || "USDT claim failed. Try again.");
    } finally {
      setClaiming(false);
    }
  }

  return createPortal(
    <div
      className="spark-success-backdrop"
      role="presentation"
      onClick={() => {
        if (!claiming) onClose({ claimed: done });
      }}
    >
      <div
        className="spark-success-popup"
        role="alertdialog"
        aria-live="polite"
        aria-labelledby="streak-usdt-claim-title"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="spark-success-popup__icon" aria-hidden>
          {done ? "✓" : "$"}
        </span>
        <h3
          id="streak-usdt-claim-title"
          className="spark-success-popup__title"
        >
          {done ? "USDT claimed!" : `Day ${item.day} USDT reward`}
        </h3>
        <p className="spark-success-popup__body">
          {done
            ? `${formatUsdtAmount(claimedAmount ?? item.amountUsdt)} is on its way to this wallet.`
            : `${formatUsdtAmount(item.amountUsdt)} is ready. Claim it now — no cost.`}
        </p>
        {error ? (
          <p className="daily-checkin-error" style={{ marginTop: 8 }}>
            {error}
          </p>
        ) : null}
        {done ? (
          <button
            type="button"
            className="spark-success-popup__btn"
            onClick={() => onClose({ claimed: true })}
          >
            Let&apos;s play
          </button>
        ) : (
          <>
            <button
              type="button"
              className="spark-success-popup__btn"
              disabled={claiming}
              onClick={() => void handleClaim()}
            >
              {claiming
                ? "Claiming…"
                : `Claim ${formatUsdtAmount(item.amountUsdt)}`}
            </button>
            <button
              type="button"
              className="spark-success-popup__btn spark-success-popup__btn--ghost"
              disabled={claiming}
              onClick={() => onClose({ claimed: false })}
              style={{ marginTop: 8, opacity: 0.85 }}
            >
              Claim later
            </button>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
