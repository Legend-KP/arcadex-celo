/**
 * TxHub + Rewards only — Forno getLogs + batched feeCurrency classify.
 * node analytics/scripts/minipay-cip64-large-rpc.mjs
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "out");
const REPORT_PARTIAL = join(OUT, "minipay-cip64-large-partial.json");

const RPCS = [
  "https://forno.celo.org",
  "https://rpc.ankr.com/celo",
];
const USDT_FEE = "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72";
const USDC_FEE = "0x2f25deb3848c207fc8e0c34035b3ba7fc157602b";

const CONTRACTS = [
  {
    name: "ArcadeXTxHub",
    address: "0x7D0fc71785B25d7878f83c4bf0E125DD89470FEc",
    startBlock: 74044804,
  },
  {
    name: "ArcadeXRewards",
    address: "0xc5BE4773D5B4a8e3C6f3E7a4C5f7cfBC38986ccF",
    startBlock: 72934573,
  },
];

let rpcI = 0;
const nextRpc = () => RPCS[(rpcI++) % RPCS.length];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(method, params, attempt = 1) {
  try {
    const res = await fetch(nextRpc(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const j = await res.json();
    if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
    return j.result;
  } catch (e) {
    if (attempt >= 8) throw e;
    await sleep(200 * attempt);
    return rpc(method, params, attempt + 1);
  }
}

async function rpcBatch(calls, attempt = 1) {
  try {
    const res = await fetch(nextRpc(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        calls.map((c, i) => ({
          jsonrpc: "2.0",
          id: i + 1,
          method: c.method,
          params: c.params,
        }))
      ),
    });
    const j = await res.json();
    if (!Array.isArray(j)) throw new Error("bad batch");
    return j
      .sort((a, b) => a.id - b.id)
      .map((x) => {
        if (x.error) throw new Error(x.error.message || JSON.stringify(x.error));
        return x.result;
      });
  } catch (e) {
    if (attempt >= 6) throw e;
    await sleep(250 * attempt);
    // fallback: sequential
    if (attempt >= 3) {
      const out = [];
      for (const c of calls) out.push(await rpc(c.method, c.params));
      return out;
    }
    return rpcBatch(calls, attempt + 1);
  }
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    })
  );
  return out;
}

async function getLogsSafe(filter, a, b) {
  try {
    return await rpc("eth_getLogs", [
      {
        ...filter,
        fromBlock: "0x" + a.toString(16),
        toBlock: "0x" + b.toString(16),
      },
    ]);
  } catch (e) {
    const msg = String(e.message || e);
    if (b > a && /range|limit|more than|exceed|timeout|truncated|query/i.test(msg)) {
      const mid = Math.floor((a + b) / 2);
      return [
        ...(await getLogsSafe(filter, a, mid)),
        ...(await getLogsSafe(filter, mid + 1, b)),
      ];
    }
    throw e;
  }
}

function hashPath(name) {
  return join(OUT, `large-hashes-${name}.json`);
}
function metaPath(name) {
  return join(OUT, `large-meta-${name}.json`);
}

function empty() {
  return {
    total: 0,
    cip64: 0,
    cip64Usdt: 0,
    cip64Usdc: 0,
    native: 0,
    feeUsdt: 0,
    feeUsdc: 0,
    feeCelo: 0,
  };
}

async function collect(contract, tip) {
  const meta = existsSync(metaPath(contract.name))
    ? JSON.parse(readFileSync(metaPath(contract.name), "utf8"))
    : { doneChunks: [], logsDone: false, txCursor: 0, bucket: empty() };

  const set = existsSync(hashPath(contract.name))
    ? new Set(JSON.parse(readFileSync(hashPath(contract.name), "utf8")))
    : new Set();

  if (!meta.logsDone) {
    const doneChunks = new Set(meta.doneChunks || []);
    const CHUNK = 5000;
    const chunks = [];
    for (let a = contract.startBlock; a <= tip; a += CHUNK) {
      const b = Math.min(a + CHUNK - 1, tip);
      const key = `${a}-${b}`;
      if (!doneChunks.has(key)) chunks.push([a, b, key]);
    }
    console.log(`[${contract.name}] chunks=${chunks.length} have=${set.size}`);
    let n = 0;
    await pool(chunks, 24, async ([a, b, key]) => {
      const logs = await getLogsSafe({ address: contract.address }, a, b);
      for (const log of logs || []) {
        if (log.transactionHash) set.add(log.transactionHash.toLowerCase());
      }
      doneChunks.add(key);
      n += 1;
      if (n % 100 === 0) {
        meta.doneChunks = [...doneChunks];
        writeFileSync(hashPath(contract.name), JSON.stringify([...set]));
        writeFileSync(metaPath(contract.name), JSON.stringify(meta));
        console.log(`[${contract.name}] logs ${n}/${chunks.length} txs=${set.size}`);
      }
    });
    meta.doneChunks = [...doneChunks];
    meta.logsDone = true;
    writeFileSync(hashPath(contract.name), JSON.stringify([...set]));
    writeFileSync(metaPath(contract.name), JSON.stringify(meta));
  }

  const hashes = [...set];
  console.log(`[${contract.name}] classify ${hashes.length} from ${meta.txCursor || 0}`);
  const bucket = meta.bucket || empty();
  let i = meta.txCursor || 0;
  if (i === 0) Object.assign(bucket, empty());

  const BATCH = 50;
  const CONC = 8;
  while (i < hashes.length) {
    const jobs = [];
    for (let c = 0; c < CONC && i < hashes.length; c++) {
      const batch = hashes.slice(i, Math.min(i + BATCH, hashes.length));
      i += batch.length;
      jobs.push(batch);
    }
    await pool(jobs, CONC, async (batch) => {
      const txs = await rpcBatch(
        batch.map((h) => ({ method: "eth_getTransactionByHash", params: [h] }))
      );
      const receipts = await rpcBatch(
        batch.map((h) => ({ method: "eth_getTransactionReceipt", params: [h] }))
      );
      for (let k = 0; k < batch.length; k++) {
        const tx = txs[k];
        const receipt = receipts[k];
        bucket.total += 1;
        if (!tx) continue;
        const gasUsed = BigInt(receipt?.gasUsed || "0x0");
        const gasPrice = BigInt(
          receipt?.effectiveGasPrice || tx.gasPrice || "0x0"
        );
        const fee = Number(gasUsed * gasPrice) / 1e18;
        const fc = (tx.feeCurrency || "").toLowerCase();
        if (fc === USDT_FEE) {
          bucket.cip64 += 1;
          bucket.cip64Usdt += 1;
          bucket.feeUsdt += fee;
        } else if (fc === USDC_FEE) {
          bucket.cip64 += 1;
          bucket.cip64Usdc += 1;
          bucket.feeUsdc += fee;
        } else if (fc) {
          bucket.cip64 += 1;
        } else {
          bucket.native += 1;
          bucket.feeCelo += fee;
        }
      }
    });
    meta.txCursor = i;
    meta.bucket = bucket;
    writeFileSync(metaPath(contract.name), JSON.stringify(meta));
    console.log(
      `[${contract.name}] ${i}/${hashes.length} cip64=${bucket.cip64} (${(
        (100 * bucket.cip64) /
        Math.max(1, bucket.total)
      ).toFixed(1)}%) feeUSDT=${bucket.feeUsdt.toFixed(2)}`
    );
  }

  return {
    name: contract.name,
    address: contract.address,
    unique_txs: hashes.length,
    ...bucket,
    minipay_cip64_pct:
      bucket.total > 0
        ? Number(((100 * bucket.cip64) / bucket.total).toFixed(2))
        : 0,
    network_fees: {
      usdt: Number(bucket.feeUsdt.toFixed(6)),
      usdc: Number(bucket.feeUsdc.toFixed(6)),
      celo: Number(bucket.feeCelo.toFixed(6)),
      stables_usd_approx: Number((bucket.feeUsdt + bucket.feeUsdc).toFixed(6)),
    },
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const tip = parseInt(await rpc("eth_blockNumber", []), 16);
  console.log(`tip=${tip}`);
  const results = {};
  for (const c of CONTRACTS) {
    console.log(`\n=== ${c.name} ===`);
    results[c.name] = await collect(c, tip);
  }
  writeFileSync(REPORT_PARTIAL, JSON.stringify({ tip, results }, null, 2));
  console.log("DONE large");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
