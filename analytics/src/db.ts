import type { ContractLabel } from "./contracts";

export interface ActivityRow {
  tx_hash: string;
  log_index: number;
  player: string;
  contract: ContractLabel;
  block_number: number;
  block_time: number;
  day: string;
}

export interface DailyMetricRow {
  day: string;
  daily_transactions: number;
  dau: number;
  wau: number;
  mau: number;
  transactions_last_7_days: number;
  transactions_last_30_days: number;
  transactions_last_60_days: number;
  transactions_last_90_days: number;
  total_transactions_to_date: number;
  txhub_transactions: number;
  rewards_transactions: number;
  sparkrefill_transactions: number;
  scoresubmit_transactions: number;
  infinitespark_transactions: number;
  updated_at: string;
}

export interface SyncMeta {
  last_synced_at: string | null;
  last_block: number | null;
  status: string;
  last_error: string | null;
  activity_rows: number;
}

export function dayFromUnix(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

export async function getSyncCursor(db: D1Database): Promise<number | null> {
  const row = await db
    .prepare("SELECT next_block FROM sync_cursor WHERE id = 1")
    .first<{ next_block: number }>();
  return row?.next_block ?? null;
}

export async function setSyncCursor(
  db: D1Database,
  nextBlock: number
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sync_cursor (id, next_block, updated_at)
       VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET next_block = excluded.next_block, updated_at = excluded.updated_at`
    )
    .bind(nextBlock, new Date().toISOString())
    .run();
}

export async function getSyncMeta(db: D1Database): Promise<SyncMeta> {
  const row = await db
    .prepare(
      `SELECT last_synced_at, last_block, status, last_error, activity_rows
       FROM sync_meta WHERE id = 1`
    )
    .first<SyncMeta>();
  return (
    row ?? {
      last_synced_at: null,
      last_block: null,
      status: "idle",
      last_error: null,
      activity_rows: 0,
    }
  );
}

export async function setSyncMeta(
  db: D1Database,
  patch: Partial<SyncMeta>
): Promise<void> {
  const current = await getSyncMeta(db);
  const next = { ...current, ...patch };
  await db
    .prepare(
      `INSERT INTO sync_meta (id, last_synced_at, last_block, status, last_error, activity_rows)
       VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         last_synced_at = excluded.last_synced_at,
         last_block = excluded.last_block,
         status = excluded.status,
         last_error = excluded.last_error,
         activity_rows = excluded.activity_rows`
    )
    .bind(
      next.last_synced_at,
      next.last_block,
      next.status,
      next.last_error,
      next.activity_rows
    )
    .run();
}

export async function upsertActivity(
  db: D1Database,
  rows: ActivityRow[]
): Promise<number> {
  if (rows.length === 0) return 0;
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO chain_activity
      (tx_hash, log_index, player, contract, block_number, block_time, day)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const batch = rows.map((r) =>
    stmt.bind(
      r.tx_hash,
      r.log_index,
      r.player,
      r.contract,
      r.block_number,
      r.block_time,
      r.day
    )
  );
  // D1 batch limit ~1000 statements; chunk at 200.
  let written = 0;
  for (let i = 0; i < batch.length; i += 200) {
    const chunk = batch.slice(i, i + 200);
    const result = await db.batch(chunk);
    for (const r of result) {
      written += r.meta?.changes ?? 0;
    }
  }
  return written;
}

export async function countActivity(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS c FROM chain_activity")
    .first<{ c: number }>();
  return row?.c ?? 0;
}

export async function loadAllActivity(
  db: D1Database
): Promise<
  Array<{
    tx_hash: string;
    player: string;
    contract: string;
    day: string;
  }>
> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT tx_hash, player, contract, day FROM chain_activity`
    )
    .all<{
      tx_hash: string;
      player: string;
      contract: string;
      day: string;
    }>();
  return results ?? [];
}

export async function replaceDailyMetrics(
  db: D1Database,
  rows: DailyMetricRow[]
): Promise<void> {
  await db.prepare("DELETE FROM daily_metrics").run();
  if (rows.length === 0) return;
  const stmt = db.prepare(
    `INSERT INTO daily_metrics (
      day, daily_transactions, dau, wau, mau,
      transactions_last_7_days, transactions_last_30_days,
      transactions_last_60_days, transactions_last_90_days,
      total_transactions_to_date,
      txhub_transactions, rewards_transactions, sparkrefill_transactions,
      scoresubmit_transactions, infinitespark_transactions, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100).map((r) =>
      stmt.bind(
        r.day,
        r.daily_transactions,
        r.dau,
        r.wau,
        r.mau,
        r.transactions_last_7_days,
        r.transactions_last_30_days,
        r.transactions_last_60_days,
        r.transactions_last_90_days,
        r.total_transactions_to_date,
        r.txhub_transactions,
        r.rewards_transactions,
        r.sparkrefill_transactions,
        r.scoresubmit_transactions,
        r.infinitespark_transactions,
        r.updated_at
      )
    );
    await db.batch(chunk);
  }
}

export async function listDailyMetrics(
  db: D1Database
): Promise<DailyMetricRow[]> {
  const { results } = await db
    .prepare(`SELECT * FROM daily_metrics ORDER BY day DESC`)
    .all<DailyMetricRow>();
  return results ?? [];
}
