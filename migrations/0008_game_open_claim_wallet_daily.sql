-- Per-wallet reserved open-claim slots for one UTC day (pending + claimed).
-- Incremented atomically at claim-sign; mark claimed does not increment again.
CREATE TABLE IF NOT EXISTS game_open_claim_wallet_daily (
  wallet TEXT NOT NULL,
  utc_day TEXT NOT NULL,
  reserved_count INTEGER NOT NULL,
  PRIMARY KEY (wallet, utc_day)
);
