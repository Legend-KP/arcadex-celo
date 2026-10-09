import {
  type DailyMetricRow,
  loadAllActivity,
  replaceDailyMetrics,
} from "./db";

function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * Mirrors the Dune rolling CTE:
 * unique_activity → daily + rolling WAU/MAU + tx windows + running total.
 * Only days with activity are emitted (same as Dune GROUP BY day).
 */
export async function recomputeDailyMetrics(db: D1Database): Promise<number> {
  const activity = await loadAllActivity(db);
  if (activity.length === 0) {
    await replaceDailyMetrics(db, []);
    return 0;
  }

  const byDay = new Map<
    string,
    {
      txs: Set<string>;
      players: Set<string>;
      byContract: Map<string, Set<string>>;
    }
  >();

  const playerDayKeys = new Map<string, Set<string>>();
  const txDayKeys = new Map<string, Set<string>>();

  for (const row of activity) {
    let bucket = byDay.get(row.day);
    if (!bucket) {
      bucket = {
        txs: new Set(),
        players: new Set(),
        byContract: new Map(),
      };
      byDay.set(row.day, bucket);
    }
    bucket.txs.add(row.tx_hash);
    bucket.players.add(row.player);
    let cset = bucket.byContract.get(row.contract);
    if (!cset) {
      cset = new Set();
      bucket.byContract.set(row.contract, cset);
    }
    cset.add(row.tx_hash);

    let pd = playerDayKeys.get(row.player);
    if (!pd) {
      pd = new Set();
      playerDayKeys.set(row.player, pd);
    }
    pd.add(row.day);

    let td = txDayKeys.get(row.tx_hash);
    if (!td) {
      td = new Set();
      txDayKeys.set(row.tx_hash, td);
    }
    td.add(row.day);
  }

  function countDistinctInWindow(
    map: Map<string, Set<string>>,
    windowStart: string,
    windowEnd: string
  ): number {
    let n = 0;
    for (const daysPresent of map.values()) {
      for (const d of daysPresent) {
        if (d >= windowStart && d <= windowEnd) {
          n += 1;
          break;
        }
      }
    }
    return n;
  }

  const days = [...byDay.keys()].sort();
  const nowIso = new Date().toISOString();
  const metrics: DailyMetricRow[] = [];
  let runningTotal = 0;

  for (const day of days) {
    const bucket = byDay.get(day)!;
    const dailyTx = bucket.txs.size;
    runningTotal += dailyTx;

    const wStart = addDays(day, -6);
    const mStart = addDays(day, -29);
    const d60 = addDays(day, -59);
    const d90 = addDays(day, -89);

    metrics.push({
      day,
      daily_transactions: dailyTx,
      dau: bucket.players.size,
      wau: countDistinctInWindow(playerDayKeys, wStart, day),
      mau: countDistinctInWindow(playerDayKeys, mStart, day),
      transactions_last_7_days: countDistinctInWindow(txDayKeys, wStart, day),
      transactions_last_30_days: countDistinctInWindow(txDayKeys, mStart, day),
      transactions_last_60_days: countDistinctInWindow(txDayKeys, d60, day),
      transactions_last_90_days: countDistinctInWindow(txDayKeys, d90, day),
      total_transactions_to_date: runningTotal,
      txhub_transactions: bucket.byContract.get("ArcadeXTxHub")?.size ?? 0,
      rewards_transactions: bucket.byContract.get("ArcadeXRewards")?.size ?? 0,
      sparkrefill_transactions: bucket.byContract.get("SparkRefill")?.size ?? 0,
      scoresubmit_transactions: bucket.byContract.get("ScoreSubmit")?.size ?? 0,
      infinitespark_transactions:
        bucket.byContract.get("InfiniteSpark")?.size ?? 0,
      updated_at: nowIso,
    });
  }

  await replaceDailyMetrics(db, metrics);
  return metrics.length;
}
