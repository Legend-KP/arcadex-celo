-- MiniPay "Sign in to ArcadeX" signatures (off-chain personal_sign, not a claim tx).
CREATE TABLE IF NOT EXISTS wallet_signins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL,
  nonce TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  signed_at INTEGER NOT NULL,
  signature TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_signins_nonce
  ON wallet_signins (nonce);

CREATE INDEX IF NOT EXISTS idx_wallet_signins_signed_at
  ON wallet_signins (signed_at DESC);
