CREATE TABLE IF NOT EXISTS repair_cursor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  next_block INTEGER NOT NULL,
  target_block INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
