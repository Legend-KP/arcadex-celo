/**
 * Local helper: trigger remote sync repeatedly until catch-up is done.
 *
 * Usage:
 *   ANALYTICS_URL=https://analytics.arcadex.trenchverse.com \
 *   ANALYTICS_SYNC_SECRET=... \
 *   npm run backfill
 */

const base = (process.env.ANALYTICS_URL || "http://127.0.0.1:8787").replace(
  /\/$/,
  ""
);
const secret = process.env.ANALYTICS_SYNC_SECRET || "";

async function post(path) {
  const url = new URL(`${base}${path}`);
  if (secret) url.searchParams.set("secret", secret);
  const res = await fetch(url, {
    method: "POST",
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return body;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function postWithRetry(path, attempts = 8) {
  let lastErr;
  for (let a = 1; a <= attempts; a++) {
    try {
      return await post(path);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const transient =
        /healthy|timeout|429|503|502|ECONNRESET|fetch failed|RPC Request failed/i.test(
          msg
        );
      console.warn(`attempt ${a}/${attempts} failed: ${msg.slice(0, 180)}`);
      if (!transient || a === attempts) break;
      await sleep(Math.min(30_000, 1500 * a));
    }
  }
  throw lastErr;
}

async function main() {
  const mode = process.argv[2] || "sync";
  console.log(`Backfill against ${base} (mode=${mode})`);
  // "repair" starts a new gap scan; "sync" continues an in-progress repair/tip.
  if (mode === "repair") {
    const started = await postWithRetry("/api/repair");
    console.log("repair started", started.repair || started);
  }

  for (let i = 1; i <= 2000; i++) {
    const body = await postWithRetry("/api/sync");
    const r = body.result || {};
    console.log(
      `#${i} tip ${r.fromBlock}->${r.toBlock} +${r.inserted}` +
        (r.repairFrom != null
          ? ` | repair ${r.repairFrom}->${r.repairTo} +${r.repairInserted} done=${r.repairDone}`
          : "") +
        ` | rows=${r.activityRows} allDone=${r.done}`
    );
    if (r.done) {
      console.log("Catch-up + gap repair complete.");
      return;
    }
  }
  console.log("Stopped after 2000 iterations; re-run if still catching up.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
