/**
 * Fast feeCurrency classify for a precollected hash list.
 * Usage: node analytics/scripts/classify-cip64-fast.mjs ArcadeXRewards
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "out");
const name = process.argv[2];
if (!name) {
  console.error("Usage: node classify-cip64-fast.mjs <ContractName>");
  process.exit(1);
}

const RPCS = [
  "https://forno.celo.org",
  "https://rpc.ankr.com/celo",
  "https://1rpc.io/celo",
];
const USDT_FEE = "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72";
const USDC_FEE = "0x2f25deb3848c207fc8e0c34035b3ba7fc157602b";

const hashPath = join(OUT, `large-hashes-${name}.json`);
const metaPath = join(OUT, `large-meta-${name}.json`);

let rpcI = 0;
const nextRpc = () => RPCS[(rpcI++) % RPCS.length];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    const byId = new Map(j.map((x) => [x.id, x]));
    return calls.map((_, i) => {
      const x = byId.get(i + 1);
      if (!x) return null;
      if (x.error) throw new Error(x.error.message || JSON.stringify(x.error));
      return x.result;
    });
  } catch (e) {
    if (attempt >= 8) throw e;
    await sleep(200 * attempt);
    if (attempt >= 4) {
      // sequential fallback, one RPC call at a time
      const out = [];
      for (const c of calls) {
        const res = await fetch(nextRpc(), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: c.method,
            params: c.params,
          }),
        });
        const j = await res.json();
        if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
        out.push(j.result);
      }
      return out;
    }
    return rpcBatch(calls, attempt + 1);
  }
}

async function pool(items, limit, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        await fn(items[idx], idx);
      }
    })
  );
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

mkdirSync(OUT, { recursive: true });
const hashes = JSON.parse(readFileSync(hashPath, "utf8"));
const meta = existsSync(metaPath)
  ? JSON.parse(readFileSync(metaPath, "utf8"))
  : { doneChunks: [], logsDone: true, txCursor: 0, bucket: empty() };

meta.logsDone = true;
const bucket = meta.bucket || empty();
let i = meta.txCursor || 0;
if (i === 0) Object.assign(bucket, empty());

console.log(`[${name}] fast-classify ${hashes.length} from ${i}`);

const BATCH = 40;
const CONC = 16;

while (i < hashes.length) {
  const jobs = [];
  for (let c = 0; c < CONC && i < hashes.length; c++) {
    const batch = hashes.slice(i, Math.min(i + BATCH, hashes.length));
    i += batch.length;
    jobs.push(batch);
  }
  await pool(jobs, CONC, async (batch) => {
    let txs;
    try {
      txs = await rpcBatch(
        batch.map((h) => ({ method: "eth_getTransactionByHash", params: [h] }))
      );
    } catch {
      txs = [];
      for (const h of batch) {
        try {
          const one = await rpcBatch([
            { method: "eth_getTransactionByHash", params: [h] },
          ]);
          txs.push(one[0]);
        } catch {
          txs.push(null);
        }
      }
    }
    // receipts in a second batch
    let receipts;
    try {
      receipts = await rpcBatch(
        batch.map((h) => ({
          method: "eth_getTransactionReceipt",
          params: [h],
        }))
      );
    } catch {
      receipts = batch.map(() => null);
    }
    for (let k = 0; k < batch.length; k++) {
      const tx = txs[k];
      const receipt = receipts[k];
      bucket.total += 1;
      if (!tx) {
        bucket.native += 1;
        continue;
      }
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
  writeFileSync(metaPath, JSON.stringify(meta));
  console.log(
    `[${name}] ${i}/${hashes.length} cip64=${bucket.cip64} (${(
      (100 * bucket.cip64) /
      Math.max(1, bucket.total)
    ).toFixed(1)}%) feeUSDT=${bucket.feeUsdt.toFixed(2)} native=${bucket.native}`
  );
}

console.log(
  `DONE ${name} total=${bucket.total} cip64=${bucket.cip64} usdt=${bucket.cip64Usdt} usdc=${bucket.cip64Usdc} native=${bucket.native} feeUsdt=${bucket.feeUsdt.toFixed(4)} feeUsdc=${bucket.feeUsdc.toFixed(4)} feeCelo=${bucket.feeCelo.toFixed(4)}`
);
