"use client";

import {
  REWARD_PAYOUTS,
  formatRewardAmount,
  truncateRewardAddress,
} from "@/lib/reward-payouts";

function PayoutItems({ ariaHidden = false }: { ariaHidden?: boolean }) {
  return (
    <>
      {REWARD_PAYOUTS.map((payout, i) => (
        <span
          key={`${payout.address}-${payout.amount}-${i}`}
          className="rewards-payout-strip-item"
          aria-hidden={ariaHidden || undefined}
        >
          <span className="rewards-payout-strip-addr">
            {truncateRewardAddress(payout.address)}
          </span>{" "}
          <span className="rewards-payout-strip-amount">
            {formatRewardAmount(payout.amount)}
          </span>
        </span>
      ))}
    </>
  );
}

export default function RewardsPayoutStrip() {
  return (
    <div className="rewards-payout-strip" aria-label="Winners payouts">
      <span className="rewards-payout-strip-label">Winners</span>
      <div className="rewards-payout-strip-viewport">
        <div className="rewards-payout-strip-track">
          <PayoutItems />
          <PayoutItems ariaHidden />
        </div>
      </div>
    </div>
  );
}
