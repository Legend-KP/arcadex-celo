/**
 * Full MiniPay CIP-64 research via Blockscout (celo.gas_token).
 * Runs all 5 contracts (large ones in parallel).
 *
 * node analytics/scripts/minipay-cip64-blockscout.mjs
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "out");
const REPORT = join(OUT, "minipay-cip64-report.json");

const BS = "https://celo.blockscout.com/api/v2";
const USDT_FEE = "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72";
const USDC_FEE = "0x2f25deb3848c207fc8e0c34035b3ba7fc157602b";
const USDT = "0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e";
const USDC = "0xceba9300f2b948710d2653dd7b07f33a8b32118c";

const CONTRACTS = [
  {
    name: "ArcadeXTxHub",
    address: "0x7D0fc71785B25d7878f83c4bf0E125DD89470FEc",
    transfers: false,
  },
  {
    name: "ArcadeXRewards",
    address: "0xc5BE4773D5B4a8e3C6f3E7a4C5f7cfBC38986ccF",
    transfers: false,
  },
  {
    name: "SparkRefill",
    address: "0xD7EA6F0212b5b54a9fA4fc2d805CE63426A48B18",
    transfers: true,
  },
  {
    name: "ScoreSubmit",
    address: "0x7EE96ddeabB9a7A93cd4A66A32aC45622028555F",
    transfers: true,
  },
  {
    name: "InfiniteSpark",
    address: "0x2a9f38b41035a900d5038D1972955011fb3278E7",
    transfers: true,
  },
];

function statePath(name) {
  return join(OUT, `bs-${name}.json`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, attempt = 1) {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 20) throw new Error(`HTTP ${res.status}`);
      const wait = Math.min(15000, 500 * 2 ** Math.min(attempt, 6));
      await sleep(wait);
      return fetchJson(url, attempt + 1);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (e) {
    if (String(e.message || e).startsWith("HTTP ")) throw e;
    if (attempt >= 20) throw e;
    await sleep(Math.min(15000, 500 * attempt));
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
      // bloom-ish: only store recent page hashes is hard; use count + page cursor
    };
  }
  return JSON.parse(readFileSync(p, "utf8"));
}

function save(st) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(statePath(st.name), JSON.stringify(st));
}

async function scanCalls(contract, st) {
  if (st.callsDone) return;
  let page = st.callsPage;
  let pages = 0;
  while (true) {
    const qs = new URLSearchParams({ filter: "to" });
    if (page) for (const [k, v] of Object.entries(page)) qs.set(k, String(v));
    const data = await fetchJson(
      `${BS}/addresses/${contract.address}/transactions?${qs}`
    );
    for (const tx of data.items || []) applyTx(st.bucket, tx, "contract_call");
    pages += 1;
    page = data.next_page_params || null;
    st.callsPage = page;
    // Save every page so resume cannot double-count
    save(st);
    if (pages % 40 === 0) {
      console.log(
        `[${contract.name}] calls pages=${pages} txs=${st.bucket.total} cip64=${st.bucket.cip64} (${(
          (100 * st.bucket.cip64) /
          Math.max(1, st.bucket.total)
        ).toFixed(1)}%)`
      );
    }
    if (!page) break;
  }
  st.callsDone = true;
  save(st);
  console.log(`[${contract.name}] calls done total=${st.bucket.total}`);
}

async function scanTransfers(contract, st) {
  if (!contract.transfers || st.transfersDone) {
    st.transfersDone = true;
    return;
  }

  if (!st.transfersListed) {
    let page = st.transfersPage;
    const pending = new Set(st.pending || []);
    let pages = 0;
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
        if (h) pending.add(h);
      }
      pages += 1;
      page = data.next_page_params || null;
      st.transfersPage = page;
      if (pages % 30 === 0) {
        st.pending = [...pending];
        save(st);
        console.log(`[${contract.name}] transfer pages=${pages} pending=${pending.size}`);
      }
      if (!page) break;
    }
    st.pending = [...pending];
    st.transfersListed = true;
    save(st);
  }

  const pending = st.pending || [];
  let i = st.pendingCursor || 0;
  console.log(`[${contract.name}] resolve transfers ${i}/${pending.length}`);

  async function pool(items, limit, fn) {
    let idx = 0;
    await Promise.all(
      Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (idx < items.length) {
          const j = idx++;
          await fn(items[j], j);
        }
      })
    );
  }

  while (i < pending.length) {
    const chunk = pending.slice(i, i + 4);
    await pool(chunk, 4, async (h) => {
      const tx = await fetchJson(`${BS}/transactions/${h}`);
      const to = (tx.to?.hash || "").toLowerCase();
      // Skip direct contract calls — already counted in calls scan
      if (to === contract.address.toLowerCase()) return;
      applyTx(st.bucket, tx, "token_transfer_tx");
    });
    i += chunk.length;
    st.pendingCursor = i;
    if (i % 160 === 0 || i >= pending.length) {
      save(st);
      console.log(
        `[${contract.name}] transfer resolved ${i}/${pending.length} cip64=${st.bucket.cip64}`
      );
    }
  }
  st.transfersDone = true;
  st.pending = [];
  save(st);
}

function summarize(name, address, bucket) {
  return {
    name,
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
      .slice(0, 12)
      .map(([method, count]) => ({ method, count })),
  };
}

async function runContract(contract) {
  const st = load(contract.name);
  st.name = contract.name;
  console.log(`\n=== ${contract.name} ===`);
  await scanCalls(contract, st);
  await scanTransfers(contract, st);
  return summarize(contract.name, contract.address, st.bucket);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log("ArcadeX MiniPay CIP-64 research (Blockscout)");

  // Small contracts first (quick), then large in parallel
  const small = CONTRACTS.filter((c) => c.transfers);
  const large = CONTRACTS.filter((c) => !c.transfers);

  const smallResults = [];
  for (const c of small) smallResults.push(await runContract(c));

  // Sequential for large contracts to avoid Blockscout 429s
  const largeResults = [];
  for (const c of large) largeResults.push(await runContract(c));

  const all = [...largeResults, ...smallResults];
  const totals = empty();
  for (const r of all) {
    const st = load(r.name);
    const b = st.bucket;
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
    totals.sources.contract_call += b.sources.contract_call || 0;
    totals.sources.token_transfer_tx += b.sources.token_transfer_tx || 0;
  }

  const report = {
    generated_at: new Date().toISOString(),
    definition: {
      minipay_proxy:
        "CIP-64: celo.gas_token is USDT fee adapter (0x0e2a3e05…) or USDC fee adapter (0x2F25deB3…). MiniPay always pays network fees this way. Native CELO gas (gas_token=null) = non-MiniPay (owner/admin/desktop/scripts).",
      note: "Payment contracts (SparkRefill/ScoreSubmit/InfiniteSpark) mostly receive ERC-20 transfer txs; those parent txs are included.",
    },
    totals: summarize("ALL", "all", totals),
    contracts: Object.fromEntries(all.map((r) => [r.name, r])),
  };

  writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log("\nDONE");
  console.log(JSON.stringify(report.totals, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
