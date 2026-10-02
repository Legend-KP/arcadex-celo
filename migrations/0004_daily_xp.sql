-- Daily XP Board: UTC-day counters, claim ledger, ban list.

CREATE TABLE IF NOT EXISTS user_daily_xp (
  wallet TEXT NOT NULL,
  utc_day TEXT NOT NULL,
  plays INTEGER NOT NULL DEFAULT 0,
  checked_in INTEGER NOT NULL DEFAULT 0,
  spend_units INTEGER NOT NULL DEFAULT 0,
  last_play_at INTEGER,
  updated_at INTEGER,
  name TEXT,
  PRIMARY KEY (wallet, utc_day)
);

CREATE TABLE IF NOT EXISTS daily_xp_leaderboard_entries (
  utc_day TEXT NOT NULL,
  wallet TEXT NOT NULL,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  plays INTEGER NOT NULL DEFAULT 0,
  checked_in INTEGER NOT NULL DEFAULT 0,
  spend_units INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER,
  PRIMARY KEY (utc_day, wallet)
);

CREATE INDEX IF NOT EXISTS idx_daily_xp_lb_score
  ON daily_xp_leaderboard_entries (utc_day, score DESC, updated_at ASC);

CREATE TABLE IF NOT EXISTS daily_xp_claims (
  wallet TEXT NOT NULL,
  utc_day TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  campaign_id INTEGER NOT NULL,
  nonce INTEGER,
  reward_amount TEXT,
  signature TEXT,
  deadline INTEGER,
  tx_hash TEXT,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER,
  PRIMARY KEY (wallet, utc_day)
);

CREATE TABLE IF NOT EXISTS daily_xp_bans (
  wallet TEXT PRIMARY KEY NOT NULL,
  reason TEXT,
  banned_at INTEGER NOT NULL,
  banned_by TEXT
);
