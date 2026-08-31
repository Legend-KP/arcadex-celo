/**
 * Distributed rate limiting via Cloudflare KV when available.
 * Falls back to per-isolate memory for local `next dev` or KV errors.
 *
 * One counter key per limit window (1 read + 1 write). If KV hits the
 * 1 write/sec/key cap, the request is allowed via memory instead.
 */

import { getWorkerKv, type KvLike } from "@/lib/worker-kv";

type RateBucket = { count: number; resetAt: number };

const memoryBuckets = new Map<string, RateBucket>();

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

function counterKey(key: string, windowId: number): string {
  return `rl:${key}:${windowId}`;
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
  const kvKey = counterKey(key, windowId);

  const total = parseCount(await kv.get(kvKey));
  if (total >= limit) {
    return false;
  }

  await kv.put(kvKey, String(total + 1), { expirationTtl: ttlSec });
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
