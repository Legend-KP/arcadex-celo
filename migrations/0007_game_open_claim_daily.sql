-- Running total of game-open claims for one UTC day. The worker also
-- creates this table if the migration has not been applied yet.
CREATE TABLE IF NOT EXISTS game_open_claim_daily (
  utc_day TEXT PRIMARY KEY,
  claim_count INTEGER NOT NULL
);
