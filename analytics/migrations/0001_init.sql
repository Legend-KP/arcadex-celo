-- ArcadeX analytics warehouse (chain events only; not the live MiniPay D1).

CREATE TABLE IF NOT EXISTS chain_activity (
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  player TEXT NOT NULL,
  contract TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  block_time INTEGER NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_chain_activity_day ON chain_activity(day);
CREATE INDEX IF NOT EXISTS idx_chain_activity_player_day ON chain_activity(player, day);
CREATE INDEX IF NOT EXISTS idx_chain_activity_contract_day ON chain_activity(contract, day);

CREATE TABLE IF NOT EXISTS sync_cursor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  next_block INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_synced_at TEXT,
  last_block INTEGER,
  status TEXT NOT NULL DEFAULT 'idle',
  last_error TEXT,
  activity_rows INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS daily_metrics (
  day TEXT PRIMARY KEY,
  daily_transactions INTEGER NOT NULL,
  dau INTEGER NOT NULL,
  wau INTEGER NOT NULL,
  mau INTEGER NOT NULL,
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

INSERT OR IGNORE INTO sync_meta (id, status) VALUES (1, 'idle');
