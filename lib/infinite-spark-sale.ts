/** Infinite Spark half-off (UI only — on-chain fee via owner setFee). */

/** Restarted 2026-11-22 — open-ended until manually disabled. */
export const INFINITE_SPARK_SALE_START_MS = Date.UTC(2026, 10, 22);
/** No end — sale stays live while this is Infinity (set a real ms to stop). */
export const INFINITE_SPARK_SALE_END_MS = Number.POSITIVE_INFINITY;

export const INFINITE_SPARK_NORMAL_USDT = 0.1;
export const INFINITE_SPARK_SALE_USDT = 0.05;

export const INFINITE_SPARK_SALE_POSTER = "/infinite-spark-sale.jpg?v=3";
/** Bump when the campaign restarts so prior dismissals don't suppress the poster. */
export const INFINITE_SPARK_SALE_PROMO_ID = "infiniteSparkSale:2026-11-22:open";

export function isInfiniteSparkSaleLive(now = Date.now()): boolean {
  return (
    now >= INFINITE_SPARK_SALE_START_MS && now < INFINITE_SPARK_SALE_END_MS
  );
}

export function formatInfiniteSparkUsdt(amount: number): string {
  return amount.toFixed(2);
}
