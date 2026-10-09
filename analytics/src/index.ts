import { getSyncMeta, listDailyMetrics } from "./db";
import type { Env } from "./env";
import { resetAnalyticsIndex, runIncrementalSync } from "./indexer";
import { renderAnalyticsHtml } from "./ui";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function unauthorized(): Response {
  return json({ error: "Unauthorized" }, 401);
}

function checkSyncAuth(request: Request, env: Env): boolean {
  const secret = env.ANALYTICS_SYNC_SECRET?.trim();
  if (!secret) return true; // open sync until secret is configured
  const header = request.headers.get("authorization") || "";
  if (header === `Bearer ${secret}`) return true;
  const url = new URL(request.url);
  return url.searchParams.get("secret") === secret;
}

async function handleMetrics(env: Env): Promise<Response> {
  const [rows, meta] = await Promise.all([
    listDailyMetrics(env.ANALYTICS_DB),
    getSyncMeta(env.ANALYTICS_DB),
  ]);
  return json({ rows, meta });
}

async function handleSync(request: Request, env: Env): Promise<Response> {
  if (!checkSyncAuth(request, env)) return unauthorized();
  try {
    const result = await runIncrementalSync(env);
    const meta = await getSyncMeta(env.ANALYTICS_DB);
    return json({ ok: true, result, meta });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
}

async function handleReset(request: Request, env: Env): Promise<Response> {
  if (!checkSyncAuth(request, env)) return unauthorized();
  try {
    await resetAnalyticsIndex(env);
    const meta = await getSyncMeta(env.ANALYTICS_DB);
    return json({
      ok: true,
      message: "Index cleared. Click Sync (or run backfill) until status is idle.",
      meta,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
      return new Response(renderAnalyticsHtml(), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    if (request.method === "GET" && pathname === "/api/metrics") {
      try {
        return await handleMetrics(env);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return json({ error: message }, 500);
      }
    }

    if (request.method === "POST" && pathname === "/api/sync") {
      return handleSync(request, env);
    }

    if (request.method === "POST" && pathname === "/api/reset") {
      return handleReset(request, env);
    }

    if (request.method === "GET" && pathname === "/api/health") {
      const meta = await getSyncMeta(env.ANALYTICS_DB).catch(() => null);
      return json({ ok: true, meta });
    }

    return json({ error: "Not found" }, 404);
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(
      runIncrementalSync(env).catch((err) => {
        console.error("analytics cron sync failed", err);
      })
    );
  },
};
