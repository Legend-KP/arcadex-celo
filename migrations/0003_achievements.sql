-- Achievements: missions catalog + claimable XP (D1 only, no KV).

ALTER TABLE users ADD COLUMN xp INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY NOT NULL,
  game_id TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  threshold INTEGER NOT NULL,
  mode TEXT,
  xp_reward INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_missions_game
  ON missions (game_id, active, sort_order);

CREATE TABLE IF NOT EXISTS achievement_claims (
  wallet TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  xp_granted INTEGER NOT NULL,
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (wallet, mission_id),
  FOREIGN KEY (wallet) REFERENCES users(wallet),
  FOREIGN KEY (mission_id) REFERENCES missions(id)
);

CREATE INDEX IF NOT EXISTS idx_achievement_claims_wallet
  ON achievement_claims (wallet);
