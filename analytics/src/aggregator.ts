import {
  type DailyMetricRow,
  listActivityDays,
  loadDailyBaseByDay,
  loadDailyContractCounts,
  loadPlayerDaysForDay,
  loadTxDaysForDay,
  replaceDailyMetrics,
} from "./db";

function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
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

/** Drop txs that fell out of the 90-day lookback so memory stays bounded. */
function pruneTxDayKeys(
  map: Map<string, Set<string>>,
  keepFrom: string
): void {
  for (const [tx, daysPresent] of map) {
    for (const d of [...daysPresent]) {
      if (d < keepFrom) daysPresent.delete(d);
    }
    if (daysPresent.size === 0) map.delete(tx);
  }
}

/**
 * Mirrors the Dune rolling CTE:
 * unique_activity → daily + lifetime users + tx windows + running total.
 * Loads day-by-day so D1 never returns a single >50MB result.
 */
export async function recomputeDailyMetrics(db: D1Database): Promise<number> {
  const days = await listActivityDays(db);
  if (days.length === 0) {
    await replaceDailyMetrics(db, []);
    return 0;
  }

  const baseByDay = await loadDailyBaseByDay(db);
  const contractByDay = await loadDailyContractCounts(db);

  const txDayKeys = new Map<string, Set<string>>();
  const lifetimeUsers = new Set<string>();
  const metrics: DailyMetricRow[] = [];
  const nowIso = new Date().toISOString();
  let runningTotal = 0;

  for (const day of days) {
    const d90 = addDays(day, -89);
    pruneTxDayKeys(txDayKeys, d90);

    const base = baseByDay.get(day) ?? { daily_transactions: 0, dau: 0 };
    runningTotal += base.daily_transactions;

    const players = await loadPlayerDaysForDay(db, day);
    for (const player of players) lifetimeUsers.add(player);

    const txs = await loadTxDaysForDay(db, day);
    for (const tx of txs) {
      let td = txDayKeys.get(tx);
      if (!td) {
        td = new Set();
        txDayKeys.set(tx, td);
      }
      td.add(day);
    }

    const contracts = contractByDay.get(day) ?? new Map<string, number>();
    const wStart = addDays(day, -6);
    const mStart = addDays(day, -29);
    const d60 = addDays(day, -59);

    metrics.push({
      day,
      daily_transactions: base.daily_transactions,
      dau: base.dau,
      total_users: lifetimeUsers.size,
      transactions_last_7_days: countDistinctInWindow(txDayKeys, wStart, day),
      transactions_last_30_days: countDistinctInWindow(txDayKeys, mStart, day),
      transactions_last_60_days: countDistinctInWindow(txDayKeys, d60, day),
      transactions_last_90_days: countDistinctInWindow(txDayKeys, d90, day),
      total_transactions_to_date: runningTotal,
      txhub_transactions: contracts.get("ArcadeXTxHub") ?? 0,
      rewards_transactions: contracts.get("ArcadeXRewards") ?? 0,
      sparkrefill_transactions: contracts.get("SparkRefill") ?? 0,
      scoresubmit_transactions: contracts.get("ScoreSubmit") ?? 0,
      infinitespark_transactions: contracts.get("InfiniteSpark") ?? 0,
      updated_at: nowIso,
    });
  }

  await replaceDailyMetrics(db, metrics);
  return metrics.length;
}
