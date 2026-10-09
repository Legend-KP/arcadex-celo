import {
  type AbiEvent,
  type Address,
  type Log,
  decodeEventLog,
  getAddress,
} from "viem";
import {
  ARCADEX_REWARDS,
  ARCADEX_TX_HUB,
  CELO_USDC,
  CELO_USDT,
  DEPLOY_TX_HASHES,
  ENTRY_PAID_ABI,
  ERC20_TRANSFER_ABI,
  INFINITE_SPARK,
  MIN_TRANSFER_VALUE,
  PAYMENT_CONTRACTS,
  REWARDS_EVENTS_ABI,
  SCORE_SUBMIT,
  SPARK_REFILL,
  TX_HUB_EVENTS_ABI,
  type ContractLabel,
} from "./contracts";
import {
  type ActivityRow,
  countActivity,
  dayFromUnix,
  getSyncCursor,
  setSyncCursor,
  setSyncMeta,
  upsertActivity,
} from "./db";
import type { Env } from "./env";
import {
  LOG_CHUNK_BLOCKS,
  SYNC_TIME_BUDGET_MS,
  createCeloClient,
  type CeloClient,
} from "./rpc";
import { recomputeDailyMetrics } from "./aggregator";

function envStartBlock(env: Env): number | null {
  const raw = env.ANALYTICS_START_BLOCK?.trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

const PAYMENT_TOS = [SPARK_REFILL, SCORE_SUBMIT, INFINITE_SPARK] as const;
const STABLES = [CELO_USDT, CELO_USDC] as const;

/** If a single getLogs returns this many rows, bisect — public RPCs often truncate. */
const LOG_BISECT_THRESHOLD = 2_000;

type EventQuery = {
  address: Address;
  event: AbiEvent;
  args?: { to?: Address };
  label: ContractLabel;
  /** How to read the player address from decoded args. */
  playerFrom: "player" | "from";
};

/**
 * One query per Dune source (topic-filtered). Avoids multi-address
 * unfiltered getLogs that Forno truncates silently.
 */
function buildEventQueries(): EventQuery[] {
  const queries: EventQuery[] = [
    {
      address: ARCADEX_TX_HUB,
      event: TX_HUB_EVENTS_ABI[0] as AbiEvent,
      label: "ArcadeXTxHub",
      playerFrom: "player",
    },
    {
      address: ARCADEX_TX_HUB,
      event: TX_HUB_EVENTS_ABI[1] as AbiEvent,
      label: "ArcadeXTxHub",
      playerFrom: "player",
    },
    {
      address: ARCADEX_REWARDS,
      event: REWARDS_EVENTS_ABI[0] as AbiEvent,
      label: "ArcadeXRewards",
      playerFrom: "player",
    },
    {
      address: ARCADEX_REWARDS,
      event: REWARDS_EVENTS_ABI[1] as AbiEvent,
      label: "ArcadeXRewards",
      playerFrom: "player",
    },
    {
      address: ARCADEX_REWARDS,
      event: REWARDS_EVENTS_ABI[2] as AbiEvent,
      label: "ArcadeXRewards",
      playerFrom: "player",
    },
    {
      address: SPARK_REFILL,
      event: ENTRY_PAID_ABI[0] as AbiEvent,
      label: "SparkRefill",
      playerFrom: "player",
    },
    {
      address: SCORE_SUBMIT,
      event: ENTRY_PAID_ABI[0] as AbiEvent,
      label: "ScoreSubmit",
      playerFrom: "player",
    },
    {
      address: INFINITE_SPARK,
      event: ENTRY_PAID_ABI[0] as AbiEvent,
      label: "InfiniteSpark",
      playerFrom: "player",
    },
  ];

  // USDT/USDC Transfer INTO each payment contract (one query each — no multi-`to` filter).
  for (const token of STABLES) {
    for (const to of PAYMENT_TOS) {
      queries.push({
        address: token,
        event: ERC20_TRANSFER_ABI[0] as AbiEvent,
        args: { to },
        label: PAYMENT_CONTRACTS[to.toLowerCase()]!,
        playerFrom: "from",
      });
    }
  }

  return queries;
}

const EVENT_QUERIES = buildEventQueries();

async function resolveStartBlock(client: CeloClient): Promise<bigint> {
  let min = BigInt(Number.MAX_SAFE_INTEGER);
  for (const hash of DEPLOY_TX_HASHES) {
    const tx = await client.getTransaction({ hash });
    if (tx.blockNumber != null && tx.blockNumber < min) {
      min = tx.blockNumber;
    }
  }
  if (min === BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Could not resolve deploy start block from deploy txs.");
  }
  return min;
}

async function blockTimesForLogs(
  client: CeloClient,
  logs: Log[]
): Promise<Map<string, number>> {
  const blocks = new Set<bigint>();
  for (const log of logs) {
    if (log.blockNumber != null) blocks.add(log.blockNumber);
  }
  const map = new Map<string, number>();
  const list = [...blocks];
  for (let i = 0; i < list.length; i += 40) {
    const chunk = list.slice(i, i + 40);
    const headers = await Promise.all(
      chunk.map((bn) => client.getBlock({ blockNumber: bn }))
    );
    for (let j = 0; j < chunk.length; j++) {
      map.set(chunk[j]!.toString(), Number(headers[j]!.timestamp));
    }
  }
  return map;
}

function rowFromLog(log: Log, q: EventQuery): ActivityRow | null {
  if (!log.transactionHash || log.blockNumber == null || log.logIndex == null) {
    return null;
  }
  try {
    const decoded = decodeEventLog({
      abi: [q.event],
      data: log.data,
      topics: log.topics,
    });
    const args = decoded.args as Record<string, unknown>;

    if (q.playerFrom === "from") {
      const value = args.value as bigint | undefined;
      const to = args.to as Address | undefined;
      const from = args.from as Address | undefined;
      if (from == null || to == null || value == null) return null;
      if (value < MIN_TRANSFER_VALUE) return null;
      if (PAYMENT_CONTRACTS[to.toLowerCase()] !== q.label) return null;
      return {
        tx_hash: log.transactionHash,
        log_index: Number(log.logIndex),
        player: getAddress(from).toLowerCase(),
        contract: q.label,
        block_number: Number(log.blockNumber),
        block_time: 0,
        day: "",
      };
    }

    const player = args.player as Address | undefined;
    if (!player) return null;
    return {
      tx_hash: log.transactionHash,
      log_index: Number(log.logIndex),
      player: getAddress(player).toLowerCase(),
      contract: q.label,
      block_number: Number(log.blockNumber),
      block_time: 0,
      day: "",
    };
  } catch {
    return null;
  }
}

async function getLogsSafe(
  client: CeloClient,
  q: EventQuery,
  fromBlock: bigint,
  toBlock: bigint
): Promise<Log[]> {
  try {
    // AbiEvent typing is loose across event shapes; runtime filters are correct.
    return await client.getLogs({
      address: q.address,
      event: q.event,
      ...(q.args?.to ? { args: { to: q.args.to } } : {}),
      fromBlock,
      toBlock,
    } as Parameters<CeloClient["getLogs"]>[0]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Range too large or response too big → bisect.
    if (
      fromBlock < toBlock &&
      /range|limit|exceed|too many|response size|query exceeds/i.test(message)
    ) {
      const mid = fromBlock + (toBlock - fromBlock) / 2n;
      const left = await getLogsSafe(client, q, fromBlock, mid);
      const right = await getLogsSafe(client, q, mid + 1n, toBlock);
      return [...left, ...right];
    }
    throw err;
  }
}

/**
 * Fetch logs for one query, bisecting when the result set is huge
 * (silent truncation risk on public RPCs).
 */
async function getLogsComplete(
  client: CeloClient,
  q: EventQuery,
  fromBlock: bigint,
  toBlock: bigint
): Promise<Log[]> {
  const logs = await getLogsSafe(client, q, fromBlock, toBlock);
  if (logs.length < LOG_BISECT_THRESHOLD || fromBlock >= toBlock) {
    return logs;
  }
  const mid = fromBlock + (toBlock - fromBlock) / 2n;
  const left = await getLogsComplete(client, q, fromBlock, mid);
  const right = await getLogsComplete(client, q, mid + 1n, toBlock);
  return [...left, ...right];
}

async function fetchChunkLogs(
  client: CeloClient,
  fromBlock: bigint,
  toBlock: bigint
): Promise<ActivityRow[]> {
  // Sequential batches of parallel queries to stay within Worker subrequest limits.
  const allLogs: Array<{ log: Log; q: EventQuery }> = [];
  const batchSize = 4;
  for (let i = 0; i < EVENT_QUERIES.length; i += batchSize) {
    const batch = EVENT_QUERIES.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (q) => {
        const logs = await getLogsComplete(client, q, fromBlock, toBlock);
        return logs.map((log) => ({ log, q }));
      })
    );
    for (const part of results) allLogs.push(...part);
  }

  const pending: Array<{ log: Log; row: ActivityRow }> = [];
  for (const { log, q } of allLogs) {
    const row = rowFromLog(log, q);
    if (row) pending.push({ log, row });
  }
  if (pending.length === 0) return [];

  const times = await blockTimesForLogs(
    client,
    pending.map((p) => p.log)
  );

  const rows: ActivityRow[] = [];
  for (const { log, row } of pending) {
    if (log.blockNumber == null) continue;
    const blockTime = times.get(log.blockNumber.toString());
    if (blockTime == null) continue;
    rows.push({
      ...row,
      block_time: blockTime,
      day: dayFromUnix(blockTime),
    });
  }
  return rows;
}

export interface SyncResult {
  fromBlock: number;
  toBlock: number;
  inserted: number;
  done: boolean;
  activityRows: number;
  chunks: number;
}

export async function resetAnalyticsIndex(env: Env): Promise<void> {
  const db = env.ANALYTICS_DB;
  await db.batch([
    db.prepare("DELETE FROM chain_activity"),
    db.prepare("DELETE FROM daily_metrics"),
    db.prepare("DELETE FROM sync_cursor"),
    db.prepare(
      `UPDATE sync_meta SET last_synced_at = NULL, last_block = NULL,
       status = 'idle', last_error = NULL, activity_rows = 0 WHERE id = 1`
    ),
  ]);
}

export async function runIncrementalSync(env: Env): Promise<SyncResult> {
  const db = env.ANALYTICS_DB;
  await setSyncMeta(db, { status: "syncing", last_error: null });
  const started = Date.now();

  try {
    const client = createCeloClient(env);
    const latest = await client.getBlockNumber();

    let cursor = await getSyncCursor(db);
    if (cursor == null) {
      const override = envStartBlock(env);
      const start =
        override != null ? BigInt(override) : await resolveStartBlock(client);
      cursor = Number(start);
      await setSyncCursor(db, cursor);
    }

    const fromBlock = BigInt(cursor);
    if (fromBlock > latest) {
      const rows = await countActivity(db);
      await setSyncMeta(db, {
        status: "idle",
        last_synced_at: new Date().toISOString(),
        last_block: Number(latest),
        activity_rows: rows,
        last_error: null,
      });
      return {
        fromBlock: Number(fromBlock),
        toBlock: Number(latest),
        inserted: 0,
        done: true,
        activityRows: rows,
        chunks: 0,
      };
    }

    let inserted = 0;
    let chunks = 0;
    let endBlock = fromBlock - 1n;

    // Smaller effective progress when each chunk does more RPC work.
    const chunkBlocks = LOG_CHUNK_BLOCKS;
    for (
      let start = fromBlock;
      start <= latest && Date.now() - started < SYNC_TIME_BUDGET_MS;
      start += chunkBlocks
    ) {
      const end =
        start + chunkBlocks - 1n > latest ? latest : start + chunkBlocks - 1n;
      const rows = await fetchChunkLogs(client, start, end);
      inserted += await upsertActivity(db, rows);
      endBlock = end;
      chunks += 1;
      await setSyncCursor(db, Number(end + 1n));
    }

    await recomputeDailyMetrics(db);
    const activityRows = await countActivity(db);
    const done = endBlock >= latest;

    await setSyncMeta(db, {
      status: done ? "idle" : "catching_up",
      last_synced_at: new Date().toISOString(),
      last_block: Number(endBlock),
      activity_rows: activityRows,
      last_error: null,
    });

    return {
      fromBlock: Number(fromBlock),
      toBlock: Number(endBlock),
      inserted,
      done,
      activityRows,
      chunks,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setSyncMeta(db, { status: "error", last_error: message });
    throw err;
  }
}
