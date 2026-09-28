-- Streak ladder USDT entitlements (mid-cycle claims; server-paid).
CREATE TABLE IF NOT EXISTS streak_usdt_pending (
  wallet TEXT NOT NULL,
  campaign_id INTEGER NOT NULL,
  day INTEGER NOT NULL,
  check_in_tx TEXT NOT NULL,
  amount_micro INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  claim_tx TEXT,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER,
  PRIMARY KEY (wallet, campaign_id, day, check_in_tx)
);

CREATE INDEX IF NOT EXISTS idx_streak_usdt_pending_wallet_status
  ON streak_usdt_pending (wallet, status);
