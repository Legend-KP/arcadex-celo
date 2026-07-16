/**
 * Distributed rate limiting via Cloudflare KV when available.
 * Falls back to per-isolate memory for local `next dev` only.
 */

type RateBucket = { count: number; resetAt: number };

const memoryBuckets = new Map<string, RateBucket>();

type KvLike = {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number }
  ): Promise<void>;
};

let warnedMissingKv = false;

async function getRateLimitKv(): Promise<KvLike | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = await getCloudflareContext({ async: true });
    const env = ctx.env as { RATE_LIMIT_KV?: KvLike };
    if (env.RATE_LIMIT_KV) return env.RATE_LIMIT_KV;
  } catch {
    // Not running inside a Cloudflare Worker (e.g. local next dev).
  }

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

async function kvCheck(
  kv: KvLike,
  key: string,
  limit: number,
  windowMs: number
): Promise<boolean> {
  const now = Date.now();
  const windowId = Math.floor(now / windowMs);
  const kvKey = `rl:${key}:${windowId}`;
  const ttlSec = Math.max(60, Math.ceil(windowMs / 1000) + 5);

  const raw = await kv.get(kvKey);
  const count = raw ? Number(raw) : 0;
  if (!Number.isFinite(count)) {
    await kv.put(kvKey, "1", { expirationTtl: ttlSec });
    return true;
  }

  if (count >= limit) {
    return false;
  }

  await kv.put(kvKey, String(count + 1), { expirationTtl: ttlSec });
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
