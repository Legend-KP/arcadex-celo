/** Shared Cloudflare KV access (RATE_LIMIT_KV binding). */

type KvLike = {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number }
  ): Promise<void>;
  delete?(key: string): Promise<void>;
};

export async function getWorkerKv(): Promise<KvLike | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = await getCloudflareContext({ async: true });
    const env = ctx.env as { RATE_LIMIT_KV?: KvLike };
    return env.RATE_LIMIT_KV ?? null;
  } catch {
    return null;
  }
}
