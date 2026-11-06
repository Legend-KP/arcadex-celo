-- Replace rolling WAU/MAU with lifetime unique wallets (total_users).
-- Metrics are recomputed on the next sync, so no data copy is needed.
DROP TABLE IF EXISTS daily_metrics;

CREATE TABLE daily_metrics (
  day TEXT PRIMARY KEY,
  daily_transactions INTEGER NOT NULL,
  dau INTEGER NOT NULL,
  total_users INTEGER NOT NULL,
  transactions_last_7_days INTEGER NOT NULL,
  transactions_last_30_days INTEGER NOT NULL,
  transactions_last_60_days INTEGER NOT NULL,
  transactions_last_90_days INTEGER NOT NULL,
  total_transactions_to_date INTEGER NOT NULL,
  txhub_transactions INTEGER NOT NULL,
  rewards_transactions INTEGER NOT NULL,
  sparkrefill_transactions INTEGER NOT NULL,
  scoresubmit_transactions INTEGER NOT NULL,
  infinitespark_transactions INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
