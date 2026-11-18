/**
 * Resume ScoreSubmit transfer resolve + full InfiniteSpark scan.
 * Does not touch TxHub/Rewards state files.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "out");
const BS = "https://celo.blockscout.com/api/v2";
const USDT_FEE = "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72";
const USDC_FEE = "0x2f25deb3848c207fc8e0c34035b3ba7fc157602b";
const USDT = "0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e";
const USDC = "0xceba9300f2b948710d2653dd7b07f33a8b32118c";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, attempt = 1) {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 30) throw new Error(`HTTP ${res.status}`);
      await sleep(Math.min(20000, 400 * 2 ** Math.min(attempt, 7)));
      return fetchJson(url, attempt + 1);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (e) {
    if (String(e.message || e).startsWith("HTTP ")) throw e;
    if (attempt >= 30) throw e;
    await sleep(Math.min(20000, 500 * attempt));
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

function applyTx(bucket, tx, source) {
  bucket.total += 1;
  bucket.sources[source] = (bucket.sources[source] || 0) + 1;
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

function statePath(name) {
  return join(OUT, `bs-${name}.json`);
}

function load(name) {
  const p = statePath(name);
  if (!existsSync(p)) {
    return {
      name,
      callsPage: null,
      callsDone: false,
      transfersPage: null,
      transfersListed: false,
      pending: [],
      pendingCursor: 0,
      transfersDone: false,
      bucket: empty(),
    };
  }
  return JSON.parse(readFileSync(p, "utf8"));
}

function save(st) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(statePath(st.name), JSON.stringify(st));
}

async function finishScoreSubmit() {
  const address = "0x7EE96ddeabB9a7A93cd4A66A32aC45622028555F";
  const st = load("ScoreSubmit");
  st.name = "ScoreSubmit";
  if (st.transfersDone) {
    console.log(`[ScoreSubmit] already done total=${st.bucket.total}`);
    return;
  }
  const pending = st.pending || [];
  let i = st.pendingCursor || 0;
  console.log(`[ScoreSubmit] resume resolve ${i}/${pending.length}`);
  while (i < pending.length) {
    const chunk = pending.slice(i, i + 6);
    await Promise.all(
      chunk.map(async (h) => {
        const tx = await fetchJson(`${BS}/transactions/${h}`);
        const to = (tx.to?.hash || "").toLowerCase();
        if (to === address.toLowerCase()) return;
        applyTx(st.bucket, tx, "token_transfer_tx");
      })
    );
    i += chunk.length;
    st.pendingCursor = i;
    if (i % 180 === 0 || i >= pending.length) {
      save(st);
      console.log(
        `[ScoreSubmit] ${i}/${pending.length} cip64=${st.bucket.cip64} total=${st.bucket.total}`
      );
    }
  }
  st.transfersDone = true;
  st.pending = [];
  save(st);
  console.log(`[ScoreSubmit] DONE total=${st.bucket.total} cip64=${st.bucket.cip64}`);
}

async function runInfiniteSpark() {
  const address = "0x2a9f38b41035a900d5038D1972955011fb3278E7";
  const st = load("InfiniteSpark");
  st.name = "InfiniteSpark";
  if (!(st.callsDone && st.transfersDone)) {
    // Reset for clean full scan if incomplete
    if (!st.callsDone) {
      st.bucket = empty();
      st.callsPage = null;
    }
  } else {
    console.log(`[InfiniteSpark] already done total=${st.bucket.total}`);
    return;
  }

  if (!st.callsDone) {
    let page = st.callsPage;
    let pages = 0;
    while (true) {
      const qs = new URLSearchParams({ filter: "to" });
      if (page) for (const [k, v] of Object.entries(page)) qs.set(k, String(v));
      const data = await fetchJson(
        `${BS}/addresses/${address}/transactions?${qs}`
      );
      for (const tx of data.items || []) applyTx(st.bucket, tx, "contract_call");
      pages += 1;
      page = data.next_page_params || null;
      st.callsPage = page;
      save(st);
      if (!page) break;
    }
    st.callsDone = true;
    save(st);
    console.log(`[InfiniteSpark] calls done total=${st.bucket.total}`);
  }

  if (!st.transfersListed) {
    let page = st.transfersPage;
    const pending = new Set(st.pending || []);
    while (true) {
      const qs = page
        ? `?${new URLSearchParams(
            Object.entries(page).map(([k, v]) => [k, String(v)])
          )}`
        : "";
      const data = await fetchJson(
        `${BS}/addresses/${address}/token-transfers${qs}`
      );
      for (const tt of data.items || []) {
        const token = (tt.token?.address_hash || "").toLowerCase();
        if (token !== USDT && token !== USDC) continue;
        const h = (tt.transaction_hash || "").toLowerCase();
        if (h) pending.add(h);
      }
      page = data.next_page_params || null;
      st.transfersPage = page;
      if (!page) break;
    }
    st.pending = [...pending];
    st.transfersListed = true;
    st.pendingCursor = 0;
    save(st);
    console.log(`[InfiniteSpark] transfers listed ${st.pending.length}`);
  }

  const pending = st.pending || [];
  let i = st.pendingCursor || 0;
  while (i < pending.length) {
    const chunk = pending.slice(i, i + 6);
    await Promise.all(
      chunk.map(async (h) => {
        const tx = await fetchJson(`${BS}/transactions/${h}`);
        const to = (tx.to?.hash || "").toLowerCase();
        if (to === address.toLowerCase()) return;
        applyTx(st.bucket, tx, "token_transfer_tx");
      })
    );
    i += chunk.length;
    st.pendingCursor = i;
    if (i % 120 === 0 || i >= pending.length) {
      save(st);
      console.log(
        `[InfiniteSpark] ${i}/${pending.length} cip64=${st.bucket.cip64}`
      );
    }
  }
  st.transfersDone = true;
  st.pending = [];
  save(st);
  console.log(
    `[InfiniteSpark] DONE total=${st.bucket.total} cip64=${st.bucket.cip64}`
  );
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  await finishScoreSubmit();
  await runInfiniteSpark();
  console.log("payment contracts DONE");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
