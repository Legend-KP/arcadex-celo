/**
 * Resume/scan one contract's direct calls for CIP-64 MiniPay classification.
 * Usage: node analytics/scripts/scan-one-cip64.mjs ArcadeXRewards 0xc5BE...
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "out");
const BS = "https://celo.blockscout.com/api/v2";
const USDT_FEE = "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72";
const USDC_FEE = "0x2f25deb3848c207fc8e0c34035b3ba7fc157602b";

const name = process.argv[2];
const address = process.argv[3];
if (!name || !address) {
  console.error("Usage: node scan-one-cip64.mjs <Name> <0xAddress>");
  process.exit(1);
}

const statePath = join(OUT, `bs-${name}.json`);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, attempt = 1) {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 40) throw new Error(`HTTP ${res.status}`);
      await sleep(Math.min(30000, 500 * 2 ** Math.min(attempt, 8)));
      return fetchJson(url, attempt + 1);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (e) {
    if (String(e.message || e).startsWith("HTTP ")) throw e;
    if (attempt >= 40) throw e;
    await sleep(Math.min(30000, 500 * attempt));
    return fetchJson(url, attempt + 1);
  }
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

function applyTx(bucket, tx) {
  bucket.total += 1;
  bucket.sources.contract_call += 1;
  if (tx.status === "ok") bucket.ok += 1;
  else if (tx.status === "error") bucket.error += 1;
  const method = tx.method || tx.decoded_input?.method_call || "unknown";
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

function saveAtomic(st) {
  mkdirSync(OUT, { recursive: true });
  const tmp = statePath + ".tmp";
  for (let i = 0; i < 8; i++) {
    try {
      writeFileSync(tmp, JSON.stringify(st));
      renameSync(tmp, statePath);
      return;
    } catch {
      // Windows file lock — retry
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150 * (i + 1));
    }
  }
  writeFileSync(statePath, JSON.stringify(st));
}

const st = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, "utf8"))
  : {
      name,
      callsPage: null,
      callsDone: false,
      transfersDone: true,
      transfersListed: true,
      pending: [],
      pendingCursor: 0,
      bucket: empty(),
    };

st.name = name;
if (!st.bucket) st.bucket = empty();

if (st.callsDone) {
  console.log(`${name} already done total=${st.bucket.total}`);
  process.exit(0);
}

let page = st.callsPage;
let pages = 0;
console.log(`START ${name} resume_total=${st.bucket.total}`);

while (true) {
  const qs = new URLSearchParams({ filter: "to" });
  if (page) for (const [k, v] of Object.entries(page)) qs.set(k, String(v));
  const data = await fetchJson(
    `${BS}/addresses/${address}/transactions?${qs}`
  );
  for (const tx of data.items || []) applyTx(st.bucket, tx);
  pages += 1;
  page = data.next_page_params || null;
  st.callsPage = page;
  if (pages % 10 === 0 || !page) saveAtomic(st);
  if (pages % 40 === 0) {
    const pct = ((100 * st.bucket.cip64) / Math.max(1, st.bucket.total)).toFixed(1);
    console.log(
      `[${name}] pages=${pages} txs=${st.bucket.total} cip64=${st.bucket.cip64} (${pct}%) native=${st.bucket.native}`
    );
  }
  if (!page) break;
  // gentle pacing to reduce 429s
  if (pages % 5 === 0) await sleep(80);
}

st.callsDone = true;
st.transfersDone = true;
saveAtomic(st);
console.log(
  `DONE ${name} total=${st.bucket.total} cip64=${st.bucket.cip64} usdt=${st.bucket.cip64Usdt} usdc=${st.bucket.cip64Usdc} native=${st.bucket.native} feeUsdt=${st.bucket.feeUsdt.toFixed(4)}`
);
