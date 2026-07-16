/**
 * Coalesce progress POSTs per wallet+game so a burst of Unity saves
 * becomes fewer RTDB writes of the highest value.
 *
 * - Solo save: short settle window (catches parallel double-posts), then write.
 * - Overlapping saves: share one in-flight write of the max value seen.
 */

export const PROGRESS_WRITE_COALESCE_MS = 2_000;

type CoalesceEntry<T> = {
  value: number;
  promise: Promise<T>;
  resolve: (result: T) => void;
  reject: (err: unknown) => void;
  /** True once the settle timer fired and write started. */
  flushing: boolean;
};

const pending = new Map<string, CoalesceEntry<unknown>>();

function coalesceKey(wallet: string, gameId: string): string {
  return `${wallet.toLowerCase()}:${gameId}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Debounce concurrent/rapid saves: collect max `value` for a short window,
 * then call `write(maxValue)` once and resolve all waiters with that result.
 */
export async function coalesceProgressWrite<T>(
  wallet: string,
  gameId: string,
  value: number,
  write: (maxValue: number) => Promise<T>
): Promise<T> {
  const key = coalesceKey(wallet, gameId);
  const existing = pending.get(key) as CoalesceEntry<T> | undefined;

  if (existing) {
    existing.value = Math.max(existing.value, value);
    return existing.promise;
  }

  let resolve!: (result: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const entry: CoalesceEntry<T> = {
    value,
    promise,
    resolve,
    reject,
    flushing: false,
  };
  pending.set(key, entry as CoalesceEntry<unknown>);

  try {
    await sleep(PROGRESS_WRITE_COALESCE_MS);

    // Keep collecting if more saves arrived; re-read max before write.
    entry.flushing = true;
    const maxValue = Math.max(
      entry.value,
      (pending.get(key) as CoalesceEntry<T> | undefined)?.value ?? value
    );
    pending.delete(key);

    const result = await write(maxValue);
    entry.resolve(result);
    return result;
  } catch (err) {
    pending.delete(key);
    entry.reject(err);
    throw err;
  }
}
