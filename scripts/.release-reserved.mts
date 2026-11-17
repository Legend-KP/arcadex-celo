/**
 * Temporary: end campaigns with pending, expireUnclaimed via Multicall3, reopen.
 * Uses SPIN_RESULT_PRIVATE_KEY || PRIVATE_KEY. No withdraw.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  decodeFunctionResult,
  encodeFunctionData,
  formatEther,
  formatUnits,
  http,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import {
  ARCADEX_REWARDS_ABI,
  ARCADEX_REWARDS_CONTRACT_ADDRESS,
} from "../lib/arcadex-rewards.ts";

const CONTRACT =
  (process.env.NEXT_PUBLIC_ARCADEX_REWARDS_CONTRACT?.trim() as Address) ||
  (ARCADEX_REWARDS_CONTRACT_ADDRESS as Address);
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as Address;
const RPC = process.env.CELO_RPC_URL?.trim() || "https://rpc.ankr.com/celo";
const LOG_STEP = BigInt(process.env.LOG_STEP?.trim() || "2000");
const EXPIRE_BATCH = 40;
const GAME_OPEN_IDS = [
  20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 35, 36, 37, 38,
];
const PENDING_FILE = path.join(process.cwd(), "scripts", ".pending-release.json");
const PAIRS_FILE = path.join(process.cwd(), "scripts", ".spin-pairs.json");

const multicallAbi = [
  {
    name: "aggregate",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "callData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      { name: "blockNumber", type: "uint256" },
      { name: "returnData", type: "bytes[]" },
    ],
  },
  {
    name: "tryAggregate",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "requireSuccess", type: "bool" },
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "callData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      {
        name: "returnData",
        type: "tuple[]",
        components: [
          { name: "success", type: "bool" },
          { name: "returnData", type: "bytes" },
        ],
      },
    ],
  },
] as const;

const spinEvent = parseAbiItem(
  "event SpinResultGranted(address indexed player, uint256 indexed campaignId, uint8 rewardMode, address rewardTarget, uint256 rewardAmount, uint256 timestamp)"
);

const publicClient = createPublicClient({
  chain: celo,
  transport: http(RPC, { timeout: 60_000, retryCount: 5, retryDelay: 1_500 }),
});

type CampaignRow = {
  active: boolean;
  requireEligibility: boolean;
  campaignType: number;
  requiredDays: number;
  minIntervalSeconds: number;
  maxClaims: number;
  startTime: bigint;
  endTime: bigint;
  rewardMode: number;
  rewardTarget: Address;
  rewardAmount: bigint;
  rewardMeta: Hex;
  resetAfterMilestone: boolean;
  maxSinglePayout: bigint;
};

type PendingRow = { player: Address; campaignId: number; amount: string };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function asCampaign(row: readonly unknown[]): CampaignRow {
  return {
    active: row[0] as boolean,
    requireEligibility: row[2] as boolean,
    campaignType: Number(row[3]),
    requiredDays: Number(row[4]),
    minIntervalSeconds: Number(row[5]),
    maxClaims: Number(row[6]),
    startTime: row[7] as bigint,
    endTime: row[8] as bigint,
    rewardMode: Number(row[9]),
    rewardTarget: row[10] as Address,
    rewardAmount: row[11] as bigint,
    rewardMeta: row[12] as Hex,
    resetAfterMilestone: row[13] as boolean,
    maxSinglePayout: row[14] as bigint,
  };
}

async function withRetry<T>(label: string, fn: () => Promise<T>, tries = 8): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const msg = err instanceof Error ? err.message : String(err);
      const wait = Math.min(30_000, 800 * 2 ** i);
      console.error(`retry ${label} #${i + 1}: ${msg.slice(0, 140)} wait ${wait}ms`);
      await sleep(wait);
    }
  }
  throw last;
}

async function readReserved() {
  return withRetry("reservedUSDT", () =>
    publicClient.readContract({
      address: CONTRACT,
      abi: ARCADEX_REWARDS_ABI,
      functionName: "reservedUSDT",
    })
  ) as Promise<bigint>;
}

async function readAvailable() {
  return withRetry("availableUSDT", () =>
    publicClient.readContract({
      address: CONTRACT,
      abi: ARCADEX_REWARDS_ABI,
      functionName: "availableUSDT",
    })
  ) as Promise<bigint>;
}

async function getCampaign(id: number) {
  const row = await withRetry(`getCampaign ${id}`, () =>
    publicClient.readContract({
      address: CONTRACT,
      abi: ARCADEX_REWARDS_ABI,
      functionName: "getCampaign",
      args: [BigInt(id)],
    })
  );
  return asCampaign(row as readonly unknown[]);
}

async function collectSpinPairs(fromBlock: bigint) {
  const latest = await withRetry("blockNumber", () => publicClient.getBlockNumber());
  const pairs = new Map<string, { player: Address; campaignId: number }>();
  for (let start = fromBlock; start <= latest; start += LOG_STEP) {
    const end = start + LOG_STEP - 1n > latest ? latest : start + LOG_STEP - 1n;
    const logs = await withRetry(`logs ${start}-${end}`, async () => {
      try {
        return await publicClient.getLogs({
          address: CONTRACT,
          event: spinEvent,
          fromBlock: start,
          toBlock: end,
        });
      } catch {
        const out = [];
        for (let s = start; s <= end; s += 400n) {
          const e2 = s + 399n > end ? end : s + 399n;
          out.push(
            ...(await publicClient.getLogs({
              address: CONTRACT,
              event: spinEvent,
              fromBlock: s,
              toBlock: e2,
            }))
          );
          await sleep(60);
        }
        return out;
      }
    });
    for (const log of logs) {
      const player = log.args.player;
      const campaignId = Number(log.args.campaignId);
      const amount = log.args.rewardAmount ?? 0n;
      if (!player || amount === 0n) continue;
      pairs.set(`${player.toLowerCase()}:${campaignId}`, { player, campaignId });
    }
    if ((start - fromBlock) % 40000n === 0n) {
      console.log(
        JSON.stringify({
          scanBlock: String(start),
          latest: String(latest),
          pairs: pairs.size,
        })
      );
    }
    await sleep(80);
  }
  return [...pairs.values()];
}

async function filterPending(
  pairs: { player: Address; campaignId: number }[]
): Promise<{ player: Address; campaignId: number; amount: bigint }[]> {
  const pending: { player: Address; campaignId: number; amount: bigint }[] = [];
  const batchSize = 80;
  for (let i = 0; i < pairs.length; i += batchSize) {
    const slice = pairs.slice(i, i + batchSize);
    const calls = slice.map((p) => ({
      target: CONTRACT,
      callData: encodeFunctionData({
        abi: ARCADEX_REWARDS_ABI,
        functionName: "wonRewards",
        args: [p.player, BigInt(p.campaignId)],
      }),
    }));
    const results = (await withRetry(`tryAgg ${i}`, () =>
      publicClient.readContract({
        address: MULTICALL3,
        abi: multicallAbi,
        functionName: "tryAggregate",
        args: [false, calls],
      })
    )) as readonly { success: boolean; returnData: Hex }[];

    for (let j = 0; j < slice.length; j++) {
      const row = results[j];
      if (!row?.success || !row.returnData || row.returnData === "0x") continue;
      try {
        const won = decodeFunctionResult({
          abi: ARCADEX_REWARDS_ABI,
          functionName: "wonRewards",
          data: row.returnData,
        }) as readonly [boolean, number, Address, bigint];
        if (won[0] && won[3] > 0n) {
          pending.push({
            player: slice[j].player,
            campaignId: slice[j].campaignId,
            amount: won[3],
          });
        }
      } catch {
        // skip
      }
    }
    if (i % 400 === 0 || i + batchSize >= pairs.length) {
      console.log(
        JSON.stringify({
          checked: Math.min(i + batchSize, pairs.length),
          of: pairs.length,
          pending: pending.length,
        })
      );
    }
    await sleep(100);
  }
  return pending;
}

function savePending(rows: { player: Address; campaignId: number; amount: bigint }[]) {
  const payload: PendingRow[] = rows.map((r) => ({
    player: r.player,
    campaignId: r.campaignId,
    amount: r.amount.toString(),
  }));
  fs.writeFileSync(PENDING_FILE, JSON.stringify(payload));
}

function loadPending():
  | { player: Address; campaignId: number; amount: bigint }[]
  | null {
  if (!fs.existsSync(PENDING_FILE)) return null;
  const raw = JSON.parse(fs.readFileSync(PENDING_FILE, "utf8")) as PendingRow[];
  return raw.map((r) => ({
    player: r.player,
    campaignId: r.campaignId,
    amount: BigInt(r.amount),
  }));
}

async function main() {
  const pkRaw =
    process.env.SPIN_RESULT_PRIVATE_KEY?.trim() ||
    process.env.PRIVATE_KEY?.trim();
  if (!pkRaw) throw new Error("SPIN_RESULT_PRIVATE_KEY / PRIVATE_KEY missing");
  const pk = (pkRaw.startsWith("0x") ? pkRaw : `0x${pkRaw}`) as Hex;
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({
    account,
    chain: celo,
    transport: http(RPC, { timeout: 60_000, retryCount: 5, retryDelay: 1_500 }),
  });

  console.log(JSON.stringify({ rpc: RPC, contract: CONTRACT }));

  const owner = (await withRetry("owner", () =>
    publicClient.readContract({
      address: CONTRACT,
      abi: ARCADEX_REWARDS_ABI,
      functionName: "owner",
    })
  )) as Address;
  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(`Signer ${account.address} is not contract owner ${owner}`);
  }

  const beforeReserved = await readReserved();
  const beforeAvailable = await readAvailable();
  console.log(
    JSON.stringify({
      phase: "start",
      signer: account.address,
      reservedUsdt: formatUnits(beforeReserved, 6),
      availableUsdt: formatUnits(beforeAvailable, 6),
    })
  );

  const receipts: { hash: Hex; gasUsed: bigint; effectiveGasPrice: bigint }[] =
    [];
  async function sendAndWait(hash: Hex) {
    const receipt = await withRetry(`receipt ${hash.slice(0, 10)}`, () =>
      publicClient.waitForTransactionReceipt({ hash })
    );
    if (receipt.status !== "success") throw new Error(`tx failed ${hash}`);
    receipts.push({
      hash,
      gasUsed: receipt.gasUsed,
      effectiveGasPrice: receipt.effectiveGasPrice ?? 0n,
    });
    return receipt;
  }

  const campaignSnap = new Map<number, CampaignRow>();
  for (const id of GAME_OPEN_IDS) {
    campaignSnap.set(id, await getCampaign(id));
  }

  for (const id of GAME_OPEN_IDS) {
    const cfg = campaignSnap.get(id)!;
    const block = await withRetry("block", () =>
      publicClient.getBlock({ blockTag: "latest" })
    );
    if (cfg.endTime !== 0n && cfg.endTime < block.timestamp) {
      console.log(JSON.stringify({ alreadyEnded: id }));
      continue;
    }
    const newEnd = block.timestamp - 1n;
    if (cfg.startTime > 0n && newEnd < cfg.startTime) {
      console.log(JSON.stringify({ skipEnd: id, reason: "newEnd < startTime" }));
      continue;
    }
    console.log(JSON.stringify({ ending: id, endTime: String(newEnd) }));
    const hash = await withRetry(`setCampaign end ${id}`, () =>
      wallet.writeContract({
        address: CONTRACT,
        abi: ARCADEX_REWARDS_ABI,
        functionName: "setCampaign",
        args: [
          BigInt(id),
          cfg.campaignType,
          cfg.active,
          cfg.requiredDays,
          cfg.minIntervalSeconds,
          cfg.maxClaims,
          cfg.startTime,
          newEnd,
          cfg.rewardMode,
          cfg.rewardTarget,
          cfg.rewardAmount,
          cfg.rewardMeta,
          cfg.resetAfterMilestone,
          cfg.requireEligibility,
          cfg.maxSinglePayout,
        ],
      })
    );
    await sendAndWait(hash);
    console.log(JSON.stringify({ ended: id, hash }));
    await sleep(250);
  }

  let pending = loadPending();
  if (pending && pending.length > 0) {
    console.log(JSON.stringify({ phase: "resumePendingFile", count: pending.length }));
    pending = await filterPending(
      pending.map((p) => ({ player: p.player, campaignId: p.campaignId }))
    );
  } else {
    const latest = await publicClient.getBlockNumber();
    const fromBlock = latest > 400000n ? latest - 400000n : 0n;
    let pairs: { player: Address; campaignId: number }[] = [];
    if (fs.existsSync(PAIRS_FILE)) {
      pairs = JSON.parse(fs.readFileSync(PAIRS_FILE, "utf8")) as {
        player: Address;
        campaignId: number;
      }[];
      console.log(JSON.stringify({ loadedPairs: pairs.length }));
    } else {
      console.log(JSON.stringify({ phase: "scan", fromBlock: String(fromBlock) }));
      pairs = await collectSpinPairs(fromBlock);
      fs.writeFileSync(PAIRS_FILE, JSON.stringify(pairs));
      console.log(JSON.stringify({ pairs: pairs.length }));
    }
    console.log("filtering pending…");
    pending = await filterPending(pairs);
  }

  const sum = pending.reduce((a, p) => a + p.amount, 0n);
  const campaignIds = [...new Set(pending.map((p) => p.campaignId))].sort(
    (a, b) => a - b
  );
  savePending(pending);
  console.log(
    JSON.stringify({
      phase: "pending",
      count: pending.length,
      sumUsdt: formatUnits(sum, 6),
      campaigns: campaignIds,
    })
  );

  if (pending.length > 0) {
    console.log(JSON.stringify({ phase: "expire", count: pending.length }));
    for (let i = 0; i < pending.length; i += EXPIRE_BATCH) {
      const batch = pending.slice(i, i + EXPIRE_BATCH);
      const calls = batch.map((p) => ({
        target: CONTRACT,
        callData: encodeFunctionData({
          abi: ARCADEX_REWARDS_ABI,
          functionName: "expireUnclaimed",
          args: [p.player, BigInt(p.campaignId)],
        }),
      }));
      console.log(
        JSON.stringify({
          multicall: `${i + 1}-${i + batch.length}/${pending.length}`,
        })
      );
      const hash = await withRetry(`multicall ${i}`, () =>
        wallet.writeContract({
          address: MULTICALL3,
          abi: multicallAbi,
          functionName: "aggregate",
          args: [calls],
        })
      );
      await sendAndWait(hash);
      console.log(JSON.stringify({ expiredBatch: hash }));
      await sleep(350);
    }

    const latest = await publicClient.getBlockNumber();
    const recentFrom = latest > 3000n ? latest - 3000n : 0n;
    const leftovers = await filterPending(await collectSpinPairs(recentFrom));
    if (leftovers.length > 0) {
      console.log(
        JSON.stringify({
          phase: "leftovers",
          count: leftovers.length,
          sumUsdt: formatUnits(
            leftovers.reduce((a, p) => a + p.amount, 0n),
            6
          ),
        })
      );
      for (const p of leftovers) {
        const hash = await withRetry(`expireOne ${p.campaignId}`, () =>
          wallet.writeContract({
            address: CONTRACT,
            abi: ARCADEX_REWARDS_ABI,
            functionName: "expireUnclaimed",
            args: [p.player, BigInt(p.campaignId)],
          })
        );
        await sendAndWait(hash);
        console.log(
          JSON.stringify({
            expiredOne: p.campaignId,
            player: p.player,
            hash,
          })
        );
        await sleep(200);
      }
    }
  } else {
    console.log("nothing to expire — reopening campaigns");
  }

  for (const id of GAME_OPEN_IDS) {
    const cfg = campaignSnap.get(id) ?? (await getCampaign(id));
    console.log(JSON.stringify({ reopening: id }));
    const hash = await withRetry(`reopen ${id}`, () =>
      wallet.writeContract({
        address: CONTRACT,
        abi: ARCADEX_REWARDS_ABI,
        functionName: "setCampaign",
        args: [
          BigInt(id),
          cfg.campaignType,
          true,
          cfg.requiredDays,
          cfg.minIntervalSeconds,
          cfg.maxClaims,
          cfg.startTime,
          0n,
          cfg.rewardMode,
          cfg.rewardTarget,
          cfg.rewardAmount,
          cfg.rewardMeta,
          cfg.resetAfterMilestone,
          cfg.requireEligibility,
          cfg.maxSinglePayout,
        ],
      })
    );
    await sendAndWait(hash);
    console.log(JSON.stringify({ reopened: id, hash }));
    await sleep(250);
  }

  const afterReserved = await readReserved();
  const afterAvailable = await readAvailable();
  let gasUsed = 0n;
  let feeWei = 0n;
  for (const r of receipts) {
    gasUsed += r.gasUsed;
    feeWei += r.gasUsed * r.effectiveGasPrice;
  }

  for (const f of [PENDING_FILE, PAIRS_FILE]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  console.log(
    JSON.stringify(
      {
        phase: "done",
        txCount: receipts.length,
        gasUsed: gasUsed.toString(),
        feeCelo: formatEther(feeWei),
        reservedBefore: formatUnits(beforeReserved, 6),
        reservedAfter: formatUnits(afterReserved, 6),
        availableBefore: formatUnits(beforeAvailable, 6),
        availableAfter: formatUnits(afterAvailable, 6),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
