import {
  type Address,
  type Log,
  decodeEventLog,
  getAddress,
  toEventSelector,
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

const ARCADE_CONTRACTS = [
  ARCADEX_TX_HUB,
  ARCADEX_REWARDS,
  SPARK_REFILL,
  SCORE_SUBMIT,
  INFINITE_SPARK,
] as const;

const PAYMENT_TOS = [SPARK_REFILL, SCORE_SUBMIT, INFINITE_SPARK] as const;

const TOPIC = {
  signedIn: toEventSelector(TX_HUB_EVENTS_ABI[0]),
  entryPaidHub: toEventSelector(TX_HUB_EVENTS_ABI[1]),
  checkedIn: toEventSelector(REWARDS_EVENTS_ABI[0]),
  spinGranted: toEventSelector(REWARDS_EVENTS_ABI[1]),
  rewardClaimed: toEventSelector(REWARDS_EVENTS_ABI[2]),
  entryPaidPayment: toEventSelector(ENTRY_PAID_ABI[0]),
  transfer: toEventSelector(ERC20_TRANSFER_ABI[0]),
} as const;

const WANTED_ARCADE_TOPICS = new Set<string>([
  TOPIC.signedIn,
  TOPIC.entryPaidHub,
  TOPIC.checkedIn,
  TOPIC.spinGranted,
  TOPIC.rewardClaimed,
  TOPIC.entryPaidPayment,
]);

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
  for (let i = 0; i < list.length; i += 25) {
    const chunk = list.slice(i, i + 25);
    const headers = await Promise.all(
      chunk.map((bn) => client.getBlock({ blockNumber: bn }))
    );
    for (let j = 0; j < chunk.length; j++) {
      map.set(chunk[j]!.toString(), Number(headers[j]!.timestamp));
    }
  }
  return map;
}

function contractLabelForAddress(address: Address): ContractLabel | null {
  const a = address.toLowerCase();
  if (a === ARCADEX_TX_HUB.toLowerCase()) return "ArcadeXTxHub";
  if (a === ARCADEX_REWARDS.toLowerCase()) return "ArcadeXRewards";
  if (a === SPARK_REFILL.toLowerCase()) return "SparkRefill";
  if (a === SCORE_SUBMIT.toLowerCase()) return "ScoreSubmit";
  if (a === INFINITE_SPARK.toLowerCase()) return "InfiniteSpark";
  return null;
}

function decodeArcadeLog(log: Log): ActivityRow | null {
  const topic0 = log.topics[0];
  if (!topic0 || !WANTED_ARCADE_TOPICS.has(topic0)) return null;
  if (!log.address || log.blockNumber == null || !log.transactionHash) return null;

  const label = contractLabelForAddress(log.address);
  if (!label) return null;

  try {
    if (topic0 === TOPIC.signedIn || topic0 === TOPIC.entryPaidHub) {
      if (label !== "ArcadeXTxHub") return null;
      const decoded = decodeEventLog({
        abi: TX_HUB_EVENTS_ABI,
        data: log.data,
        topics: log.topics,
      });
      const player = (decoded.args as { player?: Address }).player;
      if (!player) return null;
      return {
        tx_hash: log.transactionHash,
        log_index: Number(log.logIndex ?? 0),
        player: getAddress(player).toLowerCase(),
        contract: label,
        block_number: Number(log.blockNumber),
        block_time: 0,
        day: "",
      };
    }

    if (
      topic0 === TOPIC.checkedIn ||
      topic0 === TOPIC.spinGranted ||
      topic0 === TOPIC.rewardClaimed
    ) {
      if (label !== "ArcadeXRewards") return null;
      const decoded = decodeEventLog({
        abi: REWARDS_EVENTS_ABI,
        data: log.data,
        topics: log.topics,
      });
      const player = (decoded.args as { player?: Address }).player;
      if (!player) return null;
      return {
        tx_hash: log.transactionHash,
        log_index: Number(log.logIndex ?? 0),
        player: getAddress(player).toLowerCase(),
        contract: label,
        block_number: Number(log.blockNumber),
        block_time: 0,
        day: "",
      };
    }

    if (topic0 === TOPIC.entryPaidPayment) {
      if (
        label !== "SparkRefill" &&
        label !== "ScoreSubmit" &&
        label !== "InfiniteSpark"
      ) {
        return null;
      }
      const decoded = decodeEventLog({
        abi: ENTRY_PAID_ABI,
        data: log.data,
        topics: log.topics,
      });
      const player = (decoded.args as { player?: Address }).player;
      if (!player) return null;
      return {
        tx_hash: log.transactionHash,
        log_index: Number(log.logIndex ?? 0),
        player: getAddress(player).toLowerCase(),
        contract: label,
        block_number: Number(log.blockNumber),
        block_time: 0,
        day: "",
      };
    }
  } catch {
    return null;
  }
  return null;
}

function decodeTransferLog(log: Log): ActivityRow | null {
  if (!log.transactionHash || log.blockNumber == null) return null;
  try {
    const decoded = decodeEventLog({
      abi: ERC20_TRANSFER_ABI,
      data: log.data,
      topics: log.topics,
    });
    const args = decoded.args as {
      from?: Address;
      to?: Address;
      value?: bigint;
    };
    if (!args.from || !args.to || args.value == null) return null;
    if (args.value < MIN_TRANSFER_VALUE) return null;
    const label = PAYMENT_CONTRACTS[args.to.toLowerCase()];
    if (!label) return null;
    return {
      tx_hash: log.transactionHash,
      log_index: Number(log.logIndex ?? 0),
      player: getAddress(args.from).toLowerCase(),
      contract: label,
      block_number: Number(log.blockNumber),
      block_time: 0,
      day: "",
    };
  } catch {
    return null;
  }
}

async function fetchChunkLogs(
  client: CeloClient,
  fromBlock: bigint,
  toBlock: bigint
): Promise<ActivityRow[]> {
  // 3 RPC calls per chunk instead of 10: arcade contracts + USDT + USDC transfers.
  const [arcadeLogs, usdtLogs, usdcLogs] = await Promise.all([
    client.getLogs({
      address: [...ARCADE_CONTRACTS],
      fromBlock,
      toBlock,
    }),
    client.getLogs({
      address: CELO_USDT,
      event: ERC20_TRANSFER_ABI[0],
      args: { to: [...PAYMENT_TOS] },
      fromBlock,
      toBlock,
    }),
    client.getLogs({
      address: CELO_USDC,
      event: ERC20_TRANSFER_ABI[0],
      args: { to: [...PAYMENT_TOS] },
      fromBlock,
      toBlock,
    }),
  ]);

  const pending: Array<{ log: Log; row: ActivityRow }> = [];
  for (const log of arcadeLogs) {
    const row = decodeArcadeLog(log);
    if (row) pending.push({ log, row });
  }
  for (const log of [...usdtLogs, ...usdcLogs]) {
    const row = decodeTransferLog(log);
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

    for (
      let start = fromBlock;
      start <= latest && Date.now() - started < SYNC_TIME_BUDGET_MS;
      start += LOG_CHUNK_BLOCKS
    ) {
      const end =
        start + LOG_CHUNK_BLOCKS - 1n > latest
          ? latest
          : start + LOG_CHUNK_BLOCKS - 1n;
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
