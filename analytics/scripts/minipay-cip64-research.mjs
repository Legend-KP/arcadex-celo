/**
 * ArcadeX × MiniPay CIP-64 research
 * Pages Blockscout for all 5 contracts, classifies txs by celo.gas_token
 * (USDT/USDC fee-currency adapters = CIP-64 ≈ MiniPay mobile).
 *
 * Usage: node analytics/scripts/minipay-cip64-research.mjs
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "out");
const STATE_PATH = join(OUT_DIR, "minipay-cip64-state.json");
const REPORT_PATH = join(OUT_DIR, "minipay-cip64-report.json");

const BASE = "https://celo.blockscout.com/api/v2";
const USDT_FEE = "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72";
const USDC_FEE = "0x2f25deb3848c207fc8e0c34035b3ba7fc157602b";
const USDT = "0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e";
const USDC = "0xceba9300f2b948710d2653dd7b07f33a8b32118c";

const CONTRACTS = [
  {
    name: "ArcadeXTxHub",
    address: "0x7D0fc71785B25d7878f83c4bf0E125DD89470FEc",
    scanTransfers: false,
  },
  {
    name: "ArcadeXRewards",
    address: "0xc5BE4773D5B4a8e3C6f3E7a4C5f7cfBC38986ccF",
    scanTransfers: false,
  },
  {
    name: "SparkRefill",
    address: "0xD7EA6F0212b5b54a9fA4fc2d805CE63426A48B18",
    scanTransfers: true,
  },
  {
    name: "ScoreSubmit",
    address: "0x7EE96ddeabB9a7A93cd4A66A32aC45622028555F",
    scanTransfers: true,
  },
  {
    name: "InfiniteSpark",
    address: "0x2a9f38b41035a900d5038D1972955011fb3278E7",
    scanTransfers: true,
  },
];

const CONCURRENCY = 12;
const SLEEP_MS = 0;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function emptyBucket() {
  return {
    total: 0,
    ok: 0,
    error: 0,
    cip64: 0,
    cip64Usdt: 0,
    cip64Usdc: 0,
    nativeCeloFee: 0,
    feeUsdt: 0,
    feeUsdc: 0,
    feeCeloWei: 0n,
    methods: {},
    sources: { contract_call: 0, token_transfer_tx: 0 },
  };
}

function loadState() {
  if (!existsSync(STATE_PATH)) {
    return {
      contracts: Object.fromEntries(
        CONTRACTS.map((c) => [
          c.name,
          {
            txPage: null,
            txDone: false,
            transferPage: null,
            transferListDone: !c.scanTransfers,
            transferResolveDone: !c.scanTransfers,
            transferDone: !c.scanTransfers,
            bucket: serializeBucket(emptyBucket()),
            pendingTransferTxHashes: [],
            uniqueCount: 0,
          },
        ])
      ),
      startedAt: new Date().toISOString(),
    };
  }
  return JSON.parse(readFileSync(STATE_PATH, "utf8"));
}

function saveState(state) {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state));
}

function serializeBucket(b) {
  return {
    ...b,
    feeCeloWei: b.feeCeloWei.toString(),
  };
}

function deserializeBucket(raw) {
  return {
    ...emptyBucket(),
    ...raw,
    feeCeloWei: BigInt(raw.feeCeloWei || "0"),
    methods: raw.methods || {},
    sources: raw.sources || { contract_call: 0, token_transfer_tx: 0 },
  };
}

async function fetchJson(url, attempt = 1) {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (res.status === 429 || res.status >= 500) {
    if (attempt > 8) throw new Error(`HTTP ${res.status} for ${url}`);
    await sleep(500 * attempt);
    return fetchJson(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function pageQuery(params) {
  if (!params) return "";
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `&${s}` : "";
}

function classifyGasToken(gasToken) {
  if (!gasToken?.address_hash) return { kind: "native" };
  const a = gasToken.address_hash.toLowerCase();
  if (a === USDT_FEE) return { kind: "usdt" };
  if (a === USDC_FEE) return { kind: "usdc" };
  return { kind: "other", address: a, symbol: gasToken.symbol || null };
}

function applyTx(bucket, tx, source) {
  const hash = (tx.hash || "").toLowerCase();
  if (!hash) return false;

  bucket.total += 1;
  bucket.sources[source] = (bucket.sources[source] || 0) + 1;

  const status = tx.status;
  if (status === "ok" || status === true || status === "success") bucket.ok += 1;
  else if (status === "error" || status === false || status === "failed")
    bucket.error += 1;

  const method = tx.method || tx.decoded_input?.method_call || "unknown";
  bucket.methods[method] = (bucket.methods[method] || 0) + 1;

  const feeVal = BigInt(tx.fee?.value || "0");
  const cls = classifyGasToken(tx.celo?.gas_token);
  if (cls.kind === "usdt") {
    bucket.cip64 += 1;
    bucket.cip64Usdt += 1;
    bucket.feeUsdt += Number(feeVal) / 1e18;
  } else if (cls.kind === "usdc") {
    bucket.cip64 += 1;
    bucket.cip64Usdc += 1;
    bucket.feeUsdc += Number(feeVal) / 1e18;
  } else {
    bucket.nativeCeloFee += 1;
    bucket.feeCeloWei += feeVal;
  }
  return true;
}

async function mapPool(items, limit, fn) {
  const ret = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      ret[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return ret;
}

async function scanContractCalls(state, contract) {
  const st = state.contracts[contract.name];
  if (st.txDone) return;
  const bucket = deserializeBucket(st.bucket);
  const seen = new Set(); // page-local de-dupe only; cursor makes resume safe
  let page = st.txPage;
  let pages = 0;

  while (true) {
    const url = `${BASE}/addresses/${contract.address}/transactions?filter=to${pageQuery(page)}`;
    const data = await fetchJson(url);
    const items = data.items || [];
    for (const tx of items) {
      const hash = (tx.hash || "").toLowerCase();
      if (!hash || seen.has(hash)) continue;
      seen.add(hash);
      applyTx(bucket, tx, "contract_call");
    }
    pages += 1;
    st.txPage = data.next_page_params || null;
    st.bucket = serializeBucket(bucket);
    st.uniqueCount = bucket.total;
    page = st.txPage;

    if (pages % 25 === 0) {
      saveState(state);
      console.log(
        `[${contract.name}] calls pages=${pages} txs=${bucket.total} cip64=${bucket.cip64} (${(
          (100 * bucket.cip64) /
          Math.max(1, bucket.total)
        ).toFixed(1)}%)`
      );
    }
    if (!page) break;
    await sleep(SLEEP_MS);
  }

  st.txDone = true;
  st.bucket = serializeBucket(bucket);
  st.uniqueCount = bucket.total;
  saveState(state);
  console.log(`[${contract.name}] contract calls done. txs=${bucket.total}`);
}

async function scanTokenTransfers(state, contract) {
  const st = state.contracts[contract.name];
  if (st.transferDone || st.transferResolveDone) {
    st.transferDone = true;
    return;
  }
  let page = st.transferPage;
  let pages = 0;
  const pending = new Set(st.pendingTransferTxHashes || []);
  const callCountBefore = deserializeBucket(st.bucket).sources.contract_call || 0;

  if (!st.transferListDone) {
  while (true) {
    const qs = page
      ? `?${new URLSearchParams(
          Object.entries(page).map(([k, v]) => [k, String(v)])
        )}`
      : "";
    const url = `${BASE}/addresses/${contract.address}/token-transfers${qs}`;
    const data = await fetchJson(url);
    const items = data.items || [];
    for (const tt of items) {
      const token = (tt.token?.address_hash || "").toLowerCase();
      if (token !== USDT && token !== USDC) continue;
      const hash = (tt.transaction_hash || "").toLowerCase();
      if (!hash) continue;
      pending.add(hash);
    }
    pages += 1;
    st.transferPage = data.next_page_params || null;
    if (pages % 25 === 0) {
      st.pendingTransferTxHashes = [...pending];
      saveState(state);
      console.log(
        `[${contract.name}] transfers pages=${pages} unique_parent_txs=${pending.size}`
      );
    }
    page = st.transferPage;
    if (!page) break;
    await sleep(SLEEP_MS);
  }

  st.pendingTransferTxHashes = [...pending];
  st.transferListDone = true;
  saveState(state);
  }

  const bucket = deserializeBucket(st.bucket);
  const already = new Set();
  // Re-scan is resume-safe for transfers by tracking which pending hashes remain.
  const hashes = st.pendingTransferTxHashes;
  console.log(
    `[${contract.name}] resolving ${hashes.length} USDT/USDC transfer parent txs (contract_calls_so_far=${callCountBefore})…`
  );

  const remaining = [];
  for (let i = 0; i < hashes.length; i += CONCURRENCY) {
    const chunk = hashes.slice(i, i + CONCURRENCY);
    await mapPool(chunk, CONCURRENCY, async (hash) => {
      if (already.has(hash)) return;
      try {
        const tx = await fetchJson(`${BASE}/transactions/${hash}`);
        const to = (tx.to?.hash || "").toLowerCase();
        // Skip if this hash was a direct call to the payment contract (already counted)
        if (to === contract.address.toLowerCase()) {
          already.add(hash);
          return;
        }
        already.add(hash);
        applyTx(
          bucket,
          {
            hash: tx.hash,
            status: tx.status,
            method: tx.method || "transfer",
            fee: tx.fee,
            celo: tx.celo,
          },
          "token_transfer_tx"
        );
      } catch (e) {
        console.warn(`failed tx ${hash}: ${e.message}`);
        remaining.push(hash);
      }
      await sleep(SLEEP_MS);
    });
    if (i % 120 === 0) {
      st.bucket = serializeBucket(bucket);
      st.uniqueCount = bucket.total;
      st.pendingTransferTxHashes = hashes.slice(i + CONCURRENCY).concat(remaining);
      saveState(state);
      console.log(
        `[${contract.name}] transfer txs ${Math.min(i + CONCURRENCY, hashes.length)}/${hashes.length} cip64=${bucket.cip64}`
      );
    }
  }

  st.pendingTransferTxHashes = remaining;
  st.transferDone = remaining.length === 0;
  st.bucket = serializeBucket(bucket);
  st.uniqueCount = bucket.total;
  saveState(state);
  console.log(`[${contract.name}] transfers done. total_txs=${bucket.total}`);
}

function buildReport(state) {
  const perContract = {};
  let totals = emptyBucket();

  for (const c of CONTRACTS) {
    const st = state.contracts[c.name];
    const b = deserializeBucket(st.bucket);
    const feeCelo = Number(b.feeCeloWei) / 1e18;
    perContract[c.name] = {
      address: c.address,
      unique_txs: st.uniqueCount || b.total,
      total_indexed: b.total,
      success: b.ok,
      failed: b.error,
      minipay_cip64: b.cip64,
      minipay_cip64_pct:
        b.total > 0 ? Number(((100 * b.cip64) / b.total).toFixed(2)) : 0,
      cip64_usdt: b.cip64Usdt,
      cip64_usdc: b.cip64Usdc,
      non_cip64_native_celo_fee: b.nativeCeloFee,
      network_fees: {
        usdt: Number(b.feeUsdt.toFixed(6)),
        usdc: Number(b.feeUsdc.toFixed(6)),
        celo: Number(feeCelo.toFixed(6)),
        stables_usd_approx: Number((b.feeUsdt + b.feeUsdc).toFixed(6)),
      },
      sources: b.sources,
      top_methods: Object.entries(b.methods)
        .sort((a, b2) => b2[1] - a[1])
        .slice(0, 12)
        .map(([method, count]) => ({ method, count })),
    };

    totals.total += b.total;
    totals.ok += b.ok;
    totals.error += b.error;
    totals.cip64 += b.cip64;
    totals.cip64Usdt += b.cip64Usdt;
    totals.cip64Usdc += b.cip64Usdc;
    totals.nativeCeloFee += b.nativeCeloFee;
    totals.feeUsdt += b.feeUsdt;
    totals.feeUsdc += b.feeUsdc;
    totals.feeCeloWei += b.feeCeloWei;
    for (const [m, n] of Object.entries(b.methods)) {
      totals.methods[m] = (totals.methods[m] || 0) + n;
    }
    totals.sources.contract_call += b.sources.contract_call || 0;
    totals.sources.token_transfer_tx += b.sources.token_transfer_tx || 0;
  }

  const feeCelo = Number(totals.feeCeloWei) / 1e18;
  return {
    generated_at: new Date().toISOString(),
    started_at: state.startedAt,
    definition: {
      minipay_proxy:
        "CIP-64 feeCurrency set to USDT or USDC adapter (MiniPay always pays network fees in stables this way). Native-CELO-fee txs are treated as non-MiniPay (owner ops, desktop wallets, scripts).",
      usdt_fee_adapter: USDT_FEE,
      usdc_fee_adapter: USDC_FEE,
    },
    totals: {
      unique_txs_approx: totals.total,
      success: totals.ok,
      failed: totals.error,
      minipay_cip64: totals.cip64,
      minipay_cip64_pct:
        totals.total > 0
          ? Number(((100 * totals.cip64) / totals.total).toFixed(2))
          : 0,
      cip64_usdt: totals.cip64Usdt,
      cip64_usdc: totals.cip64Usdc,
      non_cip64_native_celo_fee: totals.nativeCeloFee,
      network_fees: {
        usdt: Number(totals.feeUsdt.toFixed(6)),
        usdc: Number(totals.feeUsdc.toFixed(6)),
        celo: Number(feeCelo.toFixed(6)),
        stables_usd_approx: Number(
          (totals.feeUsdt + totals.feeUsdc).toFixed(6)
        ),
      },
      sources: totals.sources,
      top_methods: Object.entries(totals.methods)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([method, count]) => ({ method, count })),
    },
    contracts: perContract,
  };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const state = loadState();
  console.log("ArcadeX MiniPay CIP-64 research starting…");

  for (const c of CONTRACTS) {
    console.log(`\n=== ${c.name} ===`);
    await scanContractCalls(state, c);
    if (c.scanTransfers) await scanTokenTransfers(state, c);
  }

  const report = buildReport(state);
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log("\nDONE");
  console.log(JSON.stringify(report.totals, null, 2));
  console.log(`Report: ${REPORT_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
