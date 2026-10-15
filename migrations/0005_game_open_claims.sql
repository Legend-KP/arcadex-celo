-- One-time-per-UTC-day USDT claim when opening a live game (hot-wallet payout).
CREATE TABLE IF NOT EXISTS game_open_claims (
  wallet TEXT NOT NULL,
  game_id TEXT NOT NULL,
  utc_day TEXT NOT NULL,
  campaign_id INTEGER NOT NULL,
  amount_micro INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  claim_tx TEXT,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER,
  PRIMARY KEY (wallet, game_id, utc_day)
);

CREATE INDEX IF NOT EXISTS idx_game_open_claims_wallet_day
  ON game_open_claims (wallet, utc_day);

CREATE INDEX IF NOT EXISTS idx_game_open_claims_claimed_day
  ON game_open_claims (utc_day, status);
