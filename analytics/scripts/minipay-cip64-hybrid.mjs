/**
 * Hybrid MiniPay CIP-64 research:
 * - Small payment contracts: Blockscout pagination (complete, fast)
 * - TxHub + Rewards: Forno getLogs + batched getTransaction
 *
 * node analytics/scripts/minipay-cip64-hybrid.mjs
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "out");
const REPORT = join(OUT, "minipay-cip64-report.json");
const STATE = join(OUT, "minipay-cip64-hybrid-state.json");

const BS = "https://celo.blockscout.com/api/v2";
const RPCS = [
  "https://forno.celo.org",
  "https://rpc.ankr.com/celo",
  "https://1rpc.io/celo",
];

const USDT_FEE = "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72";
const USDC_FEE = "0x2f25deb3848c207fc8e0c34035b3ba7fc157602b";
const USDT = "0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e";
const USDC = "0xceba9300f2b948710d2653dd7b07f33a8b32118c";

const SMALL = [
  {
    name: "SparkRefill",
    address: "0xD7EA6F0212b5b54a9fA4fc2d805CE63426A48B18",
  },
  {
    name: "ScoreSubmit",
    address: "0x7EE96ddeabB9a7A93cd4A66A32aC45622028555F",
  },
  {
    name: "InfiniteSpark",
    address: "0x2a9f38b41035a900d5038D1972955011fb3278E7",
  },
];

const LARGE = [
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, attempt = 1) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if ((res.status === 429 || res.status >= 500) && attempt < 8) {
    await sleep(400 * attempt);
    return fetchJson(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

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
    if (attempt >= 6) throw e;
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
    if (attempt >= 5) throw e;
    await sleep(250 * attempt);
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

function empty() {
  return {
    total: 0,
    ok: 0,
    error: 0,
    cip64: 0,
    cip64Usdt: 0,
    cip64Usdc: 0,
    native: 0,
    feeUsdt: 0,
    feeUsdc: 0,
    feeCelo: 0,
    methods: {},
    sources: { contract_call: 0, token_transfer_tx: 0 },
  };
}

function classifyFeeCurrency(feeCurrency) {
  const a = (feeCurrency || "").toLowerCase();
  if (!a) return "native";
  if (a === USDT_FEE) return "usdt";
  if (a === USDC_FEE) return "usdc";
  return "other";
}

function applyRpcTx(bucket, tx, receipt, source) {
  bucket.total += 1;
  bucket.sources[source] = (bucket.sources[source] || 0) + 1;
  if (receipt?.status === "0x1") bucket.ok += 1;
  else if (receipt?.status === "0x0") bucket.error += 1;

  const input = tx?.input || "0x";
  const method = input.slice(0, 10);
  bucket.methods[method] = (bucket.methods[method] || 0) + 1;

  const gasUsed = BigInt(receipt?.gasUsed || "0x0");
  const gasPrice = BigInt(receipt?.effectiveGasPrice || tx?.gasPrice || "0x0");
  const fee = Number(gasUsed * gasPrice) / 1e18;
  const kind = classifyFeeCurrency(tx?.feeCurrency);
  if (kind === "usdt") {
    bucket.cip64 += 1;
    bucket.cip64Usdt += 1;
    bucket.feeUsdt += fee;
  } else if (kind === "usdc") {
    bucket.cip64 += 1;
    bucket.cip64Usdc += 1;
    bucket.feeUsdc += fee;
  } else if (kind === "other") {
    bucket.cip64 += 1;
  } else {
    bucket.native += 1;
    bucket.feeCelo += fee;
  }
}

function applyBsTx(bucket, tx, source) {
  bucket.total += 1;
  bucket.sources[source] = (bucket.sources[source] || 0) + 1;
  if (tx.status === "ok") bucket.ok += 1;
  else if (tx.status === "error") bucket.error += 1;
  const method = tx.method || "unknown";
  bucket.methods[method] = (bucket.methods[method] || 0) + 1;
  const fee = Number(tx.fee?.value || 0) / 1e18;
  const token = (tx.celo?.gas_token?.address_hash || "").toLowerCase();
  if (token === USDT_FEE) {
    bucket.cip64 += 1;
    bucket.cip64Usdt += 1;
    bucket.feeUsdt += fee;
  } else if (token === USDC_FEE) {
    bucket.cip64 += 1;
    bucket.cip64Usdc += 1;
    bucket.feeUsdc += fee;
  } else if (token) {
    bucket.cip64 += 1;
  } else {
    bucket.native += 1;
    bucket.feeCelo += fee;
  }
}

function loadState() {
  if (!existsSync(STATE)) {
    return { contracts: {}, startedAt: new Date().toISOString() };
  }
  return JSON.parse(readFileSync(STATE, "utf8"));
}

function saveState(state) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(STATE, JSON.stringify(state));
}

async function scanSmallBlockscout(state, contract) {
  if (state.contracts[contract.name]?.done) return state.contracts[contract.name].bucket;
  const bucket = empty();
  const seen = new Set();

  // 1) Direct calls to contract
  let page = null;
  let pages = 0;
  while (true) {
    const qs = new URLSearchParams({ filter: "to" });
    if (page) for (const [k, v] of Object.entries(page)) qs.set(k, String(v));
    const data = await fetchJson(
      `${BS}/addresses/${contract.address}/transactions?${qs}`
    );
    for (const tx of data.items || []) {
      const h = (tx.hash || "").toLowerCase();
      if (!h || seen.has(h)) continue;
      seen.add(h);
      applyBsTx(bucket, tx, "contract_call");
    }
    pages += 1;
    page = data.next_page_params || null;
    if (!page) break;
  }
  console.log(`[${contract.name}] contract_calls=${bucket.sources.contract_call}`);

  // 2) USDT/USDC transfers into contract → parent txs
  page = null;
  const pending = new Set();
  while (true) {
    const qs = page
      ? `?${new URLSearchParams(
          Object.entries(page).map(([k, v]) => [k, String(v)])
        )}`
      : "";
    const data = await fetchJson(
      `${BS}/addresses/${contract.address}/token-transfers${qs}`
    );
    for (const tt of data.items || []) {
      const token = (tt.token?.address_hash || "").toLowerCase();
      if (token !== USDT && token !== USDC) continue;
      const h = (tt.transaction_hash || "").toLowerCase();
      if (!h || seen.has(h)) continue;
      pending.add(h);
    }
    page = data.next_page_params || null;
    if (!page) break;
  }
  console.log(`[${contract.name}] transfer_parent_txs=${pending.size}`);

  const hashes = [...pending];
  for (let i = 0; i < hashes.length; i += 12) {
    const chunk = hashes.slice(i, i + 12);
    await pool(chunk, 12, async (h) => {
      const tx = await fetchJson(`${BS}/transactions/${h}`);
      const to = (tx.to?.hash || "").toLowerCase();
      if (to === contract.address.toLowerCase()) return; // already counted
      if (seen.has(h)) return;
      seen.add(h);
      applyBsTx(bucket, tx, "token_transfer_tx");
    });
    if (i % 120 === 0) {
      console.log(`[${contract.name}] resolved ${Math.min(i + 12, hashes.length)}/${hashes.length}`);
    }
  }

  state.contracts[contract.name] = { done: true, bucket, unique: seen.size };
  saveState(state);
  console.log(
    `[${contract.name}] DONE total=${bucket.total} cip64=${bucket.cip64} (${(
      (100 * bucket.cip64) /
      Math.max(1, bucket.total)
    ).toFixed(1)}%)`
  );
  return bucket;
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
    if (b > a && /range|limit|more than|exceed|timeout|truncated/i.test(msg)) {
      const mid = Math.floor((a + b) / 2);
      return [
        ...(await getLogsSafe(filter, a, mid)),
        ...(await getLogsSafe(filter, mid + 1, b)),
      ];
    }
    throw e;
  }
}

async function scanLargeRpc(state, contract, tip) {
  const st = state.contracts[contract.name] || {
    done: false,
    hashes: [],
    doneChunks: [],
    txCursor: 0,
    bucket: empty(),
  };
  state.contracts[contract.name] = st;
  if (st.done) return st.bucket;

  const set = new Set(st.hashes || []);
  const doneChunks = new Set(st.doneChunks || []);
  const CHUNK = 5000;
  const chunks = [];
  for (let a = contract.startBlock; a <= tip; a += CHUNK) {
    const b = Math.min(a + CHUNK - 1, tip);
    const key = `${a}-${b}`;
    if (!doneChunks.has(key)) chunks.push([a, b, key]);
  }
  console.log(`[${contract.name}] log chunks remaining=${chunks.length} have=${set.size}`);

  let n = 0;
  await pool(chunks, 20, async ([a, b, key]) => {
    const logs = await getLogsSafe({ address: contract.address }, a, b);
    for (const log of logs || []) {
      if (log.transactionHash) set.add(log.transactionHash.toLowerCase());
    }
    doneChunks.add(key);
    n += 1;
    if (n % 80 === 0) {
      st.hashes = [...set];
      st.doneChunks = [...doneChunks];
      saveState(state);
      console.log(`[${contract.name}] logs ${n}/${chunks.length} txs=${set.size}`);
    }
  });

  st.hashes = [...set];
  st.doneChunks = [...doneChunks];
  saveState(state);
  console.log(`[${contract.name}] logs done txs=${set.size}; classifying…`);

  const bucket = st.bucket || empty();
  // Rebuild from scratch if cursor 0 to avoid partial double counts on first classify
  if (!st.txCursor) {
    Object.assign(bucket, empty());
  }
  const hashes = st.hashes;
  let i = st.txCursor || 0;
  const BATCH = 100;
  const CONC = 12;

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
        applyRpcTx(bucket, txs[k], receipts[k], "contract_call");
      }
    });
    st.txCursor = i;
    st.bucket = bucket;
    saveState(state);
    console.log(
      `[${contract.name}] classified ${i}/${hashes.length} cip64=${bucket.cip64} (${(
        (100 * bucket.cip64) /
        Math.max(1, bucket.total)
      ).toFixed(1)}%)`
    );
  }

  st.done = true;
  st.bucket = bucket;
  saveState(state);
  return bucket;
}

function summarize(name, address, bucket) {
  return {
    address,
    total_txs: bucket.total,
    success: bucket.ok,
    failed: bucket.error,
    minipay_cip64: bucket.cip64,
    minipay_cip64_pct:
      bucket.total > 0
        ? Number(((100 * bucket.cip64) / bucket.total).toFixed(2))
        : 0,
    cip64_usdt: bucket.cip64Usdt,
    cip64_usdc: bucket.cip64Usdc,
    non_minipay_native_celo_fee: bucket.native,
    network_fees: {
      usdt: Number(bucket.feeUsdt.toFixed(6)),
      usdc: Number(bucket.feeUsdc.toFixed(6)),
      celo: Number(bucket.feeCelo.toFixed(6)),
      stables_usd_approx: Number((bucket.feeUsdt + bucket.feeUsdc).toFixed(6)),
    },
    sources: bucket.sources,
    top_methods: Object.entries(bucket.methods)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([method, count]) => ({ method, count })),
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const state = loadState();
  const tip = parseInt(await rpc("eth_blockNumber", []), 16);
  console.log(`tip=${tip}`);

  const results = {};

  for (const c of SMALL) {
    console.log(`\n=== ${c.name} (Blockscout) ===`);
    const b = await scanSmallBlockscout(state, c);
    results[c.name] = summarize(c.name, c.address, b);
  }

  for (const c of LARGE) {
    console.log(`\n=== ${c.name} (RPC) ===`);
    const b = await scanLargeRpc(state, c, tip);
    results[c.name] = summarize(c.name, c.address, b);
  }

  const totals = empty();
  for (const b of Object.values(state.contracts).map((x) => x.bucket)) {
    if (!b) continue;
    totals.total += b.total;
    totals.ok += b.ok;
    totals.error += b.error;
    totals.cip64 += b.cip64;
    totals.cip64Usdt += b.cip64Usdt;
    totals.cip64Usdc += b.cip64Usdc;
    totals.native += b.native;
    totals.feeUsdt += b.feeUsdt;
    totals.feeUsdc += b.feeUsdc;
    totals.feeCelo += b.feeCelo;
    for (const [m, n] of Object.entries(b.methods || {})) {
      totals.methods[m] = (totals.methods[m] || 0) + n;
    }
    totals.sources.contract_call += b.sources?.contract_call || 0;
    totals.sources.token_transfer_tx += b.sources?.token_transfer_tx || 0;
  }

  const report = {
    generated_at: new Date().toISOString(),
    tip_block: tip,
    definition: {
      minipay:
        "CIP-64 feeCurrency = USDT adapter (0x0e2a…) or USDC adapter (0x2F25…). MiniPay always uses this. Native CELO gas = non-MiniPay.",
      includes:
        "All unique txs emitting logs on TxHub/Rewards, plus all contract calls + USDT/USDC inbound transfers for SparkRefill/ScoreSubmit/InfiniteSpark.",
    },
    totals: summarize("ALL", "all", totals),
    contracts: results,
  };
  writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log("\nDONE");
  console.log(JSON.stringify(report.totals, null, 2));
  console.log(`Wrote ${REPORT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
