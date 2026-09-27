-- Lifetime XP and one saved row per ISO week.
-- Weights match lib/activity-week.ts: plays×10 + active days×5 + txs×1 + spend×1.

CREATE TABLE IF NOT EXISTS user_xp (
  wallet TEXT PRIMARY KEY NOT NULL,
  all_time_xp INTEGER NOT NULL DEFAULT 0,
  best_week_xp INTEGER NOT NULL DEFAULT 0,
  best_week_id TEXT,
  weeks_recorded INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS user_week_xp (
  wallet TEXT NOT NULL,
  week_id TEXT NOT NULL,
  xp INTEGER NOT NULL,
  updated_at INTEGER,
  PRIMARY KEY (wallet, week_id)
);

CREATE INDEX IF NOT EXISTS idx_user_week_xp_wallet
  ON user_week_xp (wallet, xp DESC);

INSERT OR IGNORE INTO user_week_xp (wallet, week_id, xp, updated_at)
SELECT
  wallet,
  week_id,
  sparks_spent * 10 + active_days * 5 + txs + spend_units,
  updated_at
FROM user_activity
WHERE sparks_spent * 10 + active_days * 5 + txs + spend_units > 0;

INSERT OR IGNORE INTO user_xp (
  wallet, all_time_xp, best_week_xp, best_week_id, weeks_recorded, updated_at
)
SELECT
  t.wallet,
  t.all_time_xp,
  t.best_week_xp,
  (
    SELECT w.week_id
    FROM user_week_xp w
    WHERE w.wallet = t.wallet
    ORDER BY w.xp DESC, w.updated_at ASC
    LIMIT 1
  ),
  t.weeks_recorded,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM (
  SELECT
    wallet,
    SUM(xp) AS all_time_xp,
    MAX(xp) AS best_week_xp,
    COUNT(*) AS weeks_recorded
  FROM user_week_xp
  GROUP BY wallet
) t;
