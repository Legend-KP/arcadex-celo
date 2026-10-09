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

async function syncOnce() {
  const url = new URL(`${base}/api/sync`);
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

async function main() {
  console.log(`Backfill against ${base}`);
  for (let i = 1; i <= 500; i++) {
    const body = await syncOnce();
    const r = body.result || {};
    console.log(
      `#${i} blocks ${r.fromBlock}->${r.toBlock} inserted=${r.inserted} done=${r.done} rows=${r.activityRows}`
    );
    if (r.done) {
      console.log("Catch-up complete.");
      return;
    }
  }
  console.log("Stopped after 500 iterations; re-run if still catching up.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
