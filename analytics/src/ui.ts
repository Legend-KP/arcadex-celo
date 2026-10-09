export function renderAnalyticsHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ArcadeX — Analytics</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #f7f7f5;
      --panel: #ffffff;
      --ink: #1a1a1a;
      --muted: #6b6b6b;
      --line: #e6e6e2;
      --line-strong: #d0d0ca;
      --accent: #111111;
      --row-alt: #fafaf8;
      --header: #f0f0ec;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: "IBM Plex Sans", system-ui, sans-serif;
      min-height: 100%;
    }
    body {
      background:
        radial-gradient(1200px 500px at 10% -10%, #ebeae4 0%, transparent 55%),
        radial-gradient(900px 400px at 100% 0%, #e8ece8 0%, transparent 50%),
        var(--bg);
    }
    .wrap {
      max-width: 1280px;
      margin: 0 auto;
      padding: 28px 20px 48px;
    }
    header.top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 20px;
    }
    .brand h1 {
      margin: 0;
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -0.03em;
      line-height: 1.1;
    }
    .meta {
      margin-top: 6px;
      color: var(--muted);
      font-size: 13px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px 14px;
    }
    .meta a { color: var(--muted); text-decoration: none; }
    .meta a:hover { color: var(--ink); text-decoration: underline; }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    button, .btn {
      appearance: none;
      border: 1px solid var(--line-strong);
      background: var(--panel);
      color: var(--ink);
      font: 500 13px/1 "IBM Plex Sans", system-ui, sans-serif;
      padding: 8px 12px;
      border-radius: 6px;
      cursor: pointer;
    }
    button:hover, .btn:hover { background: var(--header); }
    button.primary {
      background: var(--accent);
      color: #fff;
      border-color: var(--accent);
    }
    button.primary:hover { opacity: 0.92; }
    button:disabled { opacity: 0.55; cursor: wait; }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 1px 0 rgba(0,0,0,0.02);
    }
    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
    }
    .panel-head h2 {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
    }
    .status {
      font-size: 12px;
      color: var(--muted);
      font-family: "IBM Plex Mono", ui-monospace, monospace;
    }
    .table-scroll {
      overflow: auto;
      max-height: min(70vh, 720px);
    }
    table {
      width: max-content;
      min-width: 100%;
      border-collapse: collapse;
      font-family: "IBM Plex Mono", ui-monospace, monospace;
      font-size: 12.5px;
    }
    th, td {
      text-align: left;
      padding: 9px 12px;
      border-bottom: 1px solid var(--line);
      white-space: nowrap;
    }
    th {
      position: sticky;
      top: 0;
      background: var(--header);
      font-weight: 600;
      z-index: 1;
    }
    tbody tr:nth-child(even) { background: var(--row-alt); }
    tbody tr:hover { background: #f3f5f1; }
    .panel-foot {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 16px;
      border-top: 1px solid var(--line);
      background: #fcfcfa;
      font-size: 12.5px;
      color: var(--muted);
    }
    .panel-foot input {
      border: 1px solid var(--line-strong);
      border-radius: 6px;
      padding: 6px 10px;
      font: 12.5px "IBM Plex Sans", system-ui, sans-serif;
      min-width: 160px;
    }
    .pager {
      display: flex;
      gap: 4px;
      align-items: center;
    }
    .pager button {
      min-width: 32px;
      padding: 6px 8px;
    }
    .pager button.active {
      background: var(--accent);
      color: #fff;
      border-color: var(--accent);
    }
    .empty {
      padding: 48px 20px;
      text-align: center;
      color: var(--muted);
    }
    .error {
      margin-top: 12px;
      color: #9b1c1c;
      font-size: 13px;
    }
    @media (max-width: 720px) {
      header.top { flex-direction: column; }
      .brand h1 { font-size: 24px; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="top">
      <div class="brand">
        <h1>ArcadeX</h1>
        <div class="meta">
          <span>by <a href="https://trenchverse.com" target="_blank" rel="noreferrer">@trenchverse</a></span>
          <span id="lastUpdated">Last updated —</span>
          <span id="syncStatus"></span>
        </div>
      </div>
      <div class="actions">
        <button type="button" id="shareBtn">Share</button>
        <button type="button" id="syncBtn">Sync</button>
        <button type="button" class="primary" id="runBtn">Run</button>
      </div>
    </header>

    <section class="panel">
      <div class="panel-head">
        <h2>Query results ArcadeX.</h2>
        <div class="status" id="rowHint"></div>
      </div>
      <div class="table-scroll" id="tableHost">
        <div class="empty">Loading metrics…</div>
      </div>
      <div class="panel-foot">
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
          <span id="rowCount">0 rows</span>
          <input id="search" type="search" placeholder="Search…" />
        </div>
        <div class="pager" id="pager"></div>
      </div>
    </section>
    <div class="error" id="error" hidden></div>
  </div>

  <script>
    const COLUMNS = [
      "day",
      "daily_transactions",
      "dau",
      "wau",
      "mau",
      "transactions_last_7_days",
      "transactions_last_30_days",
      "transactions_last_60_days",
      "transactions_last_90_days",
      "total_transactions_to_date",
      "txhub_transactions",
      "rewards_transactions",
      "sparkrefill_transactions",
      "scoresubmit_transactions",
      "infinitespark_transactions"
    ];

    const PAGE_SIZE = 25;
    let rows = [];
    let filtered = [];
    let page = 1;

    function fmtDay(day) {
      if (!day) return "";
      return day + " 00:00:00";
    }

    function fmtNum(n) {
      if (n == null) return "";
      return Number(n).toLocaleString("en-US");
    }

    function relativeTime(iso) {
      if (!iso) return "—";
      const t = new Date(iso).getTime();
      if (Number.isNaN(t)) return iso;
      const diff = Date.now() - t;
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return "just now";
      if (mins < 60) return mins + " min ago";
      const hrs = Math.floor(mins / 60);
      if (hrs < 48) return hrs + " hr ago";
      const days = Math.floor(hrs / 24);
      return days + " days ago";
    }

    function setError(msg) {
      const el = document.getElementById("error");
      if (!msg) {
        el.hidden = true;
        el.textContent = "";
        return;
      }
      el.hidden = false;
      el.textContent = msg;
    }

    function applyFilter() {
      const q = (document.getElementById("search").value || "").trim().toLowerCase();
      filtered = !q
        ? rows.slice()
        : rows.filter((r) =>
            COLUMNS.some((c) => String(r[c] ?? "").toLowerCase().includes(q))
          );
      page = 1;
      render();
    }

    function renderPager(totalPages) {
      const pager = document.getElementById("pager");
      pager.innerHTML = "";
      if (totalPages <= 1) return;

      const mk = (label, p, disabled, active) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        if (active) b.classList.add("active");
        b.disabled = disabled;
        b.onclick = () => {
          page = p;
          render();
        };
        return b;
      };

      pager.appendChild(mk("<", Math.max(1, page - 1), page === 1, false));
      const windowStart = Math.max(1, page - 2);
      const windowEnd = Math.min(totalPages, windowStart + 4);
      for (let p = windowStart; p <= windowEnd; p++) {
        pager.appendChild(mk(String(p), p, false, p === page));
      }
      if (windowEnd < totalPages) {
        const dots = document.createElement("span");
        dots.textContent = "…";
        pager.appendChild(dots);
        pager.appendChild(mk(String(totalPages), totalPages, false, false));
      }
      pager.appendChild(mk(">", Math.min(totalPages, page + 1), page === totalPages, false));
    }

    function render() {
      const host = document.getElementById("tableHost");
      document.getElementById("rowCount").textContent = filtered.length + " rows";
      document.getElementById("rowHint").textContent =
        filtered.length === 0 ? "" : "Ordered by day DESC";

      if (filtered.length === 0) {
        host.innerHTML = '<div class="empty">No rows yet. Click Sync to index Celo events, then Run.</div>';
        document.getElementById("pager").innerHTML = "";
        return;
      }

      const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      if (page > totalPages) page = totalPages;
      const start = (page - 1) * PAGE_SIZE;
      const slice = filtered.slice(start, start + PAGE_SIZE);

      let html = "<table><thead><tr>";
      for (const c of COLUMNS) html += "<th>" + c + "</th>";
      html += "</tr></thead><tbody>";
      for (const r of slice) {
        html += "<tr>";
        for (const c of COLUMNS) {
          const v = c === "day" ? fmtDay(r.day) : fmtNum(r[c]);
          html += "<td>" + v + "</td>";
        }
        html += "</tr>";
      }
      html += "</tbody></table>";
      host.innerHTML = html;
      renderPager(totalPages);
    }

    async function loadMetrics() {
      setError("");
      const runBtn = document.getElementById("runBtn");
      runBtn.disabled = true;
      try {
        const res = await fetch("/api/metrics", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load metrics");
        rows = Array.isArray(data.rows) ? data.rows : [];
        document.getElementById("lastUpdated").textContent =
          "Last updated " + relativeTime(data.meta && data.meta.last_synced_at);
        const st = data.meta && data.meta.status ? data.meta.status : "";
        const blk = data.meta && data.meta.last_block != null ? " · block " + data.meta.last_block : "";
        document.getElementById("syncStatus").textContent = st ? ("Sync: " + st + blk) : "";
        applyFilter();
      } catch (e) {
        setError(e.message || String(e));
      } finally {
        runBtn.disabled = false;
      }
    }

    async function triggerSync() {
      setError("");
      const syncBtn = document.getElementById("syncBtn");
      syncBtn.disabled = true;
      syncBtn.textContent = "Syncing…";
      try {
        const res = await fetch("/api/sync", { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Sync failed");
        await loadMetrics();
        if (data.result && data.result.done === false) {
          setError("Catch-up in progress (indexed through block " + data.result.toBlock + "). Click Sync again until done.");
        }
      } catch (e) {
        setError(e.message || String(e));
      } finally {
        syncBtn.disabled = false;
        syncBtn.textContent = "Sync";
      }
    }

    document.getElementById("runBtn").onclick = () => loadMetrics();
    document.getElementById("syncBtn").onclick = () => triggerSync();
    document.getElementById("search").oninput = () => applyFilter();
    document.getElementById("shareBtn").onclick = async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        const b = document.getElementById("shareBtn");
        const prev = b.textContent;
        b.textContent = "Copied";
        setTimeout(() => { b.textContent = prev; }, 1200);
      } catch {
        setError("Could not copy URL");
      }
    };

    loadMetrics();
  </script>
</body>
</html>`;
}
