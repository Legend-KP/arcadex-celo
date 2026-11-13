/**
 * Fast ArcadeX MiniPay CIP-64 research via Forno JSON-RPC batches.
 * node analytics/scripts/minipay-cip64-rpc.mjs
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "out");
const STATE = join(OUT, "minipay-cip64-rpc-state.json");
const REPORT = join(OUT, "minipay-cip64-report.json");

const RPCS = [
  "https://forno.celo.org",
  "https://rpc.ankr.com/celo",
  "https://1rpc.io/celo",
];

const USDT_FEE = "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72";
const USDC_FEE = "0x2f25deb3848c207fc8e0c34035b3ba7fc157602b";
const USDT = "0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e";
const USDC = "0xceba9300f2b948710d2653dd7b07f33a8b32118c";
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const CONTRACTS = [
  {
    name: "ArcadeXTxHub",
    address: "0x7D0fc71785B25d7878f83c4bf0E125DD89470FEc",
    startBlock: 74044804,
    transfers: false,
  },
  {
    name: "ArcadeXRewards",
    address: "0xc5BE4773D5B4a8e3C6f3E7a4C5f7cfBC38986ccF",
    startBlock: 72934573,
    transfers: false,
  },
  {
    name: "SparkRefill",
    address: "0xD7EA6F0212b5b54a9fA4fc2d805CE63426A48B18",
    startBlock: 70569788,
    transfers: true,
  },
  {
    name: "ScoreSubmit",
    address: "0x7EE96ddeabB9a7A93cd4A66A32aC45622028555F",
    startBlock: 71693429,
    transfers: true,
  },
  {
    name: "InfiniteSpark",
    address: "0x2a9f38b41035a900d5038D1972955011fb3278E7",
    startBlock: 70560908,
    transfers: true,
  },
];

const LOG_CHUNK = 5000;
const LOG_CONCURRENCY = 16;
const TX_BATCH = 80;
const TX_CONCURRENCY = 10;

let rpcIndex = 0;
function nextRpc() {
  const u = RPCS[rpcIndex % RPCS.length];
  rpcIndex += 1;
  return u;
}

async function rpc(method, params, attempt = 1) {
  const url = nextRpc();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
    return json.result;
  } catch (e) {
    if (attempt >= 6) throw e;
    await new Promise((r) => setTimeout(r, 250 * attempt));
    return rpc(method, params, attempt + 1);
  }
}

async function rpcBatch(calls, attempt = 1) {
  const url = nextRpc();
  const body = calls.map((c, i) => ({
    jsonrpc: "2.0",
    id: i + 1,
    method: c.method,
    params: c.params,
  }));
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!Array.isArray(json)) throw new Error("batch not array");
    return json.sort((a, b) => a.id - b.id).map((x) => {
      if (x.error) throw new Error(x.error.message || JSON.stringify(x.error));
      return x.result;
    });
  } catch (e) {
    if (attempt >= 5) throw e;
    await new Promise((r) => setTimeout(r, 300 * attempt));
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

function padTopicAddress(addr) {
  return "0x" + addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function loadState() {
  if (!existsSync(STATE)) {
    return {
      tip: null,
      contracts: Object.fromEntries(
        CONTRACTS.map((c) => [
          c.name,
          {
            hashes: [],
            logCursor: c.startBlock,
            logsDone: false,
            txCursor: 0,
            classified: null,
          },
        ])
      ),
      startedAt: new Date().toISOString(),
    };
  }
  return JSON.parse(readFileSync(STATE, "utf8"));
}

function saveState(state) {
  mkdirSync(OUT, { recursive: true });
  // Keep state lean — hashes live in hashes-*.json
  const slim = {
    ...state,
    contracts: Object.fromEntries(
      Object.entries(state.contracts).map(([name, st]) => [
        name,
        {
          ...st,
          hashes: undefined,
          hashCount: st.hashes?.length || st.hashCount || 0,
        },
      ])
    ),
  };
  writeFileSync(STATE, JSON.stringify(slim));
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
      const left = await getLogsSafe(filter, a, mid);
      const right = await getLogsSafe(filter, mid + 1, b);
      return [...(left || []), ...(right || [])];
    }
    throw e;
  }
}

function hashFile(name) {
  return join(OUT, `hashes-${name}.json`);
}

function loadHashes(name, fallback = []) {
  const p = hashFile(name);
  if (!existsSync(p)) return new Set(fallback);
  return new Set(JSON.parse(readFileSync(p, "utf8")));
}

function saveHashes(name, set) {
  writeFileSync(hashFile(name), JSON.stringify([...set]));
}

async function collectLogsForContract(state, tip, contract) {
  const st = state.contracts[contract.name];
  if (st.logsDone) {
    if (!st.hashes?.length) st.hashes = [...loadHashes(contract.name)];
    return;
  }

  const set = loadHashes(contract.name, st.hashes || []);
  const doneChunks = new Set(st.doneChunks || []);
  const chunks = [];
  for (let a = contract.startBlock; a <= tip; a += LOG_CHUNK) {
    const b = Math.min(a + LOG_CHUNK - 1, tip);
    const key = `${a}-${b}`;
    if (!doneChunks.has(key)) chunks.push([a, b, key]);
  }

  console.log(
    `[${contract.name}] getLogs remaining_chunks=${chunks.length} have_txs=${set.size}`
  );

  let done = 0;
  await pool(chunks, LOG_CONCURRENCY, async ([a, b, key]) => {
    const logs = await getLogsSafe({ address: contract.address }, a, b);
    for (const log of logs || []) {
      if (log.transactionHash) set.add(log.transactionHash.toLowerCase());
    }

    if (contract.transfers) {
      const toTopic = padTopicAddress(contract.address);
      for (const token of [USDT, USDC]) {
        const tlogs = await getLogsSafe(
          {
            address: token,
            topics: [TRANSFER_TOPIC, null, toTopic],
          },
          a,
          b
        );
        for (const log of tlogs || []) {
          if (log.transactionHash) set.add(log.transactionHash.toLowerCase());
        }
      }
    }

    doneChunks.add(key);
    done += 1;
    if (done % 50 === 0) {
      st.doneChunks = [...doneChunks];
      saveHashes(contract.name, set);
      saveState(state);
      console.log(
        `[${contract.name}] logs ${done}/${chunks.length} unique_txs=${set.size}`
      );
    }
  });

  st.hashes = [...set];
  st.doneChunks = [...doneChunks];
  st.logsDone = true;
  saveHashes(contract.name, set);
  saveState(state);
  console.log(`[${contract.name}] logs done unique_txs=${set.size}`);
}

function emptyClass() {
  return {
    total: 0,
    cip64: 0,
    cip64Usdt: 0,
    cip64Usdc: 0,
    cip64Other: 0,
    native: 0,
    missing: 0,
    feeUsdt: 0,
    feeUsdc: 0,
    feeCelo: 0,
    feeOther: 0,
  };
}

async function classifyContract(state, contract) {
  const st = state.contracts[contract.name];
  const hashes = st.hashes?.length
    ? st.hashes
    : [...loadHashes(contract.name)];
  st.hashes = hashes;
  if (st.classified && st.txCursor >= hashes.length) return st.classified;

  const cls = st.classified || emptyClass();
  let i = st.txCursor || 0;
  console.log(`[${contract.name}] classify ${hashes.length} txs from ${i}`);

  while (i < hashes.length) {
    const sliceJobs = [];
    for (let c = 0; c < TX_CONCURRENCY && i < hashes.length; c++) {
      const batch = hashes.slice(i, i + TX_BATCH);
      i += batch.length;
      sliceJobs.push(batch);
    }

    await pool(sliceJobs, TX_CONCURRENCY, async (batch) => {
      const txs = await rpcBatch(
        batch.map((h) => ({
          method: "eth_getTransactionByHash",
          params: [h],
        }))
      );
      const receipts = await rpcBatch(
        batch.map((h) => ({
          method: "eth_getTransactionReceipt",
          params: [h],
        }))
      );

      for (let k = 0; k < batch.length; k++) {
        const tx = txs[k];
        const receipt = receipts[k];
        cls.total += 1;
        if (!tx) {
          cls.missing += 1;
          continue;
        }
        const feeCurrency = (tx.feeCurrency || "").toLowerCase();
        const gasUsed = BigInt(receipt?.gasUsed || "0x0");
        const gasPrice = BigInt(
          receipt?.effectiveGasPrice || tx.gasPrice || "0x0"
        );
        const fee = Number(gasUsed * gasPrice) / 1e18;

        if (!feeCurrency) {
          cls.native += 1;
          cls.feeCelo += fee;
        } else if (feeCurrency === USDT_FEE) {
          cls.cip64 += 1;
          cls.cip64Usdt += 1;
          cls.feeUsdt += fee;
        } else if (feeCurrency === USDC_FEE) {
          cls.cip64 += 1;
          cls.cip64Usdc += 1;
          cls.feeUsdc += fee;
        } else {
          cls.cip64 += 1;
          cls.cip64Other += 1;
          cls.feeOther += fee;
        }
      }
    });

    st.txCursor = i;
    st.classified = cls;
    saveState(state);
    console.log(
      `[${contract.name}] classified ${i}/${hashes.length} cip64=${cls.cip64} (${(
        (100 * cls.cip64) /
        Math.max(1, cls.total)
      ).toFixed(1)}%)`
    );
  }

  st.classified = cls;
  saveState(state);
  return cls;
}

function buildReport(state) {
  const contracts = {};
  const totals = emptyClass();

  for (const c of CONTRACTS) {
    const st = state.contracts[c.name];
    const cls = st.classified || emptyClass();
    contracts[c.name] = {
      address: c.address,
      start_block: c.startBlock,
      unique_txs: st.hashes.length,
      ...cls,
      minipay_cip64_pct:
        cls.total > 0 ? Number(((100 * cls.cip64) / cls.total).toFixed(2)) : 0,
      network_fees: {
        usdt: Number(cls.feeUsdt.toFixed(6)),
        usdc: Number(cls.feeUsdc.toFixed(6)),
        celo: Number(cls.feeCelo.toFixed(6)),
        other_fee_token: Number(cls.feeOther.toFixed(6)),
        stables_usd_approx: Number((cls.feeUsdt + cls.feeUsdc).toFixed(6)),
      },
    };
    for (const k of Object.keys(totals)) {
      if (typeof totals[k] === "number") totals[k] += cls[k] || 0;
    }
  }

  return {
    generated_at: new Date().toISOString(),
    started_at: state.startedAt,
    tip_block: state.tip,
    definition: {
      minipay_heuristic:
        "Tx has CIP-64 feeCurrency = USDT or USDC adapter. MiniPay always sends CIP-64 stable gas; native-CELO-fee txs are non-MiniPay (owner/admin/desktop/scripts).",
      usdt_fee_adapter: USDT_FEE,
      usdc_fee_adapter: USDC_FEE,
      scope:
        "All unique txs that emitted logs on each ArcadeX contract, plus USDT/USDC Transfer-into payment contracts (SparkRefill, ScoreSubmit, InfiniteSpark).",
    },
    totals: {
      ...totals,
      minipay_cip64_pct:
        totals.total > 0
          ? Number(((100 * totals.cip64) / totals.total).toFixed(2))
          : 0,
      network_fees: {
        usdt: Number(totals.feeUsdt.toFixed(6)),
        usdc: Number(totals.feeUsdc.toFixed(6)),
        celo: Number(totals.feeCelo.toFixed(6)),
        other_fee_token: Number(totals.feeOther.toFixed(6)),
        stables_usd_approx: Number(
          (totals.feeUsdt + totals.feeUsdc).toFixed(6)
        ),
      },
    },
    contracts,
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const state = loadState();
  const tipHex = await rpc("eth_blockNumber", []);
  const tip = parseInt(tipHex, 16);
  state.tip = tip;
  saveState(state);
  console.log(`tip=${tip}`);

  // Collect logs (contracts with fewer txs first so we get early signal)
  const ordered = [...CONTRACTS].sort(
    (a, b) => Number(a.transfers) - Number(b.transfers) || a.startBlock - b.startBlock
  );

  // Run small contracts fully first, then big ones. Parallelize small payment trio.
  for (const c of ordered.filter((x) => x.transfers)) {
    await collectLogsForContract(state, tip, c);
    await classifyContract(state, c);
  }
  for (const c of ordered.filter((x) => !x.transfers)) {
    await collectLogsForContract(state, tip, c);
    await classifyContract(state, c);
  }

  const report = buildReport(state);
  writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log("DONE");
  console.log(JSON.stringify(report.totals, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
