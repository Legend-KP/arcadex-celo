/**
 * Cloudflare D1 access for the hybrid player store.
 *
 * On when Worker has `DB` + `PLAYER_DATA_BACKEND=d1`.
 * Production MiniPay stays on RTDB until you flip the var after migration.
 */

type D1PreparedStatement = {
  bind: (...values: unknown[]) => D1PreparedStatement;
  first: <T = unknown>() => Promise<T | null>;
  all: <T = unknown>() => Promise<{ results: T[] }>;
  run: () => Promise<{ success: boolean; meta?: { changes?: number } }>;
};

export type D1DatabaseLike = {
  prepare: (query: string) => D1PreparedStatement;
  batch: (
    statements: D1PreparedStatement[]
  ) => Promise<Array<{ success: boolean }>>;
};

type EnvWithD1 = {
  DB?: D1DatabaseLike;
  PLAYER_DATA_BACKEND?: string;
};

async function getEnv(): Promise<EnvWithD1 | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = await getCloudflareContext({ async: true });
    return (ctx.env as EnvWithD1) ?? null;
  } catch {
    return null;
  }
}

export async function useD1PlayerData(): Promise<boolean> {
  const env = await getEnv();
  if (!env?.DB) return false;
  const backend = (
    env.PLAYER_DATA_BACKEND ??
    process.env.PLAYER_DATA_BACKEND ??
    ""
  )
    .trim()
    .toLowerCase();
  return backend === "d1";
}

export async function getD1(): Promise<D1DatabaseLike | null> {
  if (!(await useD1PlayerData())) return null;
  const env = await getEnv();
  return env?.DB ?? null;
}

export async function requireD1(): Promise<D1DatabaseLike> {
  const db = await getD1();
  if (!db) {
    throw new Error(
      "D1 player store unavailable. Set PLAYER_DATA_BACKEND=d1 and bind DB."
    );
  }
  return db;
}
