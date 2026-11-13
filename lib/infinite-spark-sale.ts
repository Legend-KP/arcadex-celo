/** Timed Infinite Spark half-off window (UI only — on-chain fee via owner setFee). */

export const INFINITE_SPARK_SALE_START_MS = Date.UTC(2026, 10, 14); // 2026-11-14 00:00 UTC
export const INFINITE_SPARK_SALE_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
export const INFINITE_SPARK_SALE_END_MS =
  INFINITE_SPARK_SALE_START_MS + INFINITE_SPARK_SALE_DURATION_MS;

export const INFINITE_SPARK_NORMAL_USDT = 0.1;
export const INFINITE_SPARK_SALE_USDT = 0.05;

export const INFINITE_SPARK_SALE_POSTER = "/infinite-spark-sale.jpg";
export const INFINITE_SPARK_SALE_PROMO_ID = "infiniteSparkSale:2026-11-14";

export function isInfiniteSparkSaleLive(now = Date.now()): boolean {
  return now >= INFINITE_SPARK_SALE_START_MS && now < INFINITE_SPARK_SALE_END_MS;
}

export function formatInfiniteSparkUsdt(amount: number): string {
  return amount.toFixed(2);
}
