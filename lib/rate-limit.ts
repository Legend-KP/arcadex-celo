/**
 * Distributed rate limiting via Cloudflare KV when available.
 * Falls back to per-isolate memory for local `next dev` only.
 *
 * KV allows 1 write/sec per key. Counters are sharded so concurrent
 * requests increment different keys, then summed with one bulk get.
 */

import { getWorkerKv, type KvLike } from "@/lib/worker-kv";

type RateBucket = { count: number; resetAt: number };

const memoryBuckets = new Map<string, RateBucket>();

/** 32 shards → ~32 writes/sec per logical key before hitting KV's per-key cap. */
const RATE_LIMIT_SHARDS = 32;
const SHARD_PUT_RETRIES = 4;

let warnedMissingKv = false;

async function getRateLimitKv(): Promise<KvLike | null> {
  const kv = await getWorkerKv();
  if (kv) return kv;

  if (process.env.NODE_ENV === "production" && !warnedMissingKv) {
    warnedMissingKv = true;
    console.warn(
      "[ArcadeX] RATE_LIMIT_KV binding missing — rate limits are per-isolate only. Bind a KV namespace named RATE_LIMIT_KV in wrangler.jsonc."
    );
  }

  return null;
}

export function getClientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function memoryCheck(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = memoryBuckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    memoryBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= limit) {
    return false;
  }

  bucket.count += 1;
  return true;
}

function parseCount(raw: string | null | undefined): number {
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function shardKey(key: string, windowId: number, shard: number): string {
  return `rl:${key}:${windowId}:${shard}`;
}

function pickShard(): number {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] % RATE_LIMIT_SHARDS;
}

async function readShardCounts(
  kv: KvLike,
  keys: string[]
): Promise<number[]> {
  try {
    const map = await kv.get(keys);
    if (map && typeof map.get === "function") {
      return keys.map((k) => parseCount(map.get(k)));
    }
  } catch {
    // Preview / mock KV may not support bulk get.
  }

  const singles = await Promise.all(keys.map((k) => kv.get(k)));
  return singles.map((raw) => parseCount(raw));
}

async function kvCheck(
  kv: KvLike,
  key: string,
  limit: number,
  windowMs: number
): Promise<boolean> {
  const now = Date.now();
  const windowId = Math.floor(now / windowMs);
  const ttlSec = Math.max(60, Math.ceil(windowMs / 1000) + 5);
  const keys = Array.from({ length: RATE_LIMIT_SHARDS }, (_, shard) =>
    shardKey(key, windowId, shard)
  );

  const counts = await readShardCounts(kv, keys);
  const total = counts.reduce((sum, n) => sum + n, 0);
  if (total >= limit) {
    return false;
  }

  let shard = pickShard();
  for (let attempt = 0; attempt < SHARD_PUT_RETRIES; attempt++) {
    const next = counts[shard] + 1;
    try {
      await kv.put(keys[shard], String(next), { expirationTtl: ttlSec });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isHotKey =
        message.includes("429") || /too many|rate limit/i.test(message);
      if (!isHotKey || attempt === SHARD_PUT_RETRIES - 1) {
        throw err;
      }
      shard = (shard + 1 + pickShard()) % RATE_LIMIT_SHARDS;
    }
  }

  return true;
}

/**
 * Returns true if the request is allowed.
 * Uses Cloudflare KV when bound (global); otherwise in-memory (dev / misconfig).
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<boolean> {
  const kv = await getRateLimitKv();
  if (kv) {
    try {
      return await kvCheck(kv, key, limit, windowMs);
    } catch (err) {
      console.warn(
        "[ArcadeX] KV rate-limit error; falling back to memory:",
        err instanceof Error ? err.message : err
      );
    }
  }

  return memoryCheck(key, limit, windowMs);
}

/** Returns false if any key in the group is over limit. */
export async function checkRateLimitGroup(
  keys: string[],
  limit: number,
  windowMs: number
): Promise<boolean> {
  for (const key of keys) {
    if (!(await checkRateLimit(key, limit, windowMs))) {
      return false;
    }
  }
  return true;
}

export function rateLimitResponse(): Response {
  return Response.json(
    { error: "Too many requests. Please try again later." },
    { status: 429 }
  );
}
