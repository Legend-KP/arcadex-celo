# ArcadeX Analytics

Isolated Cloudflare Worker that indexes ArcadeX on-chain activity on Celo and serves a Dune-style daily metrics table.

**Does not use** the live MiniPay app’s D1, Firestore, KV, or UI.

## Domain

Point `analytics.arcadex.trenchverse.com` at this Worker (`arcadex-analytics`), not the MiniPay Worker.

## Setup

```bash
cd analytics
npm install

# Create a dedicated D1 database (once)
npm run db:create
# Paste the returned database_id into wrangler.jsonc → d1_databases[0].database_id

npm run db:migrate:remote
npm run deploy
```

Optional secret (recommended after go-live):

```bash
npx wrangler secret put ANALYTICS_SYNC_SECRET
```

When set, `POST /api/sync` requires `Authorization: Bearer <secret>` (or `?secret=`).

## Local

```bash
npm run db:migrate:local
npm run dev
```

Open the printed `localhost` URL. Use **Sync** (or `npm run backfill`) until catch-up finishes. Each run spends ~25s indexing 5k-block chunks (Forno’s max range). Cron also runs every 15 minutes in production.

Optional vars in `wrangler.jsonc` / secrets:

- `ANALYTICS_START_BLOCK` — skip empty history before this block on first sync
- `CELO_RPC_URL` — override public Forno RPC
- `ANALYTICS_SYNC_SECRET` — lock down `POST /api/sync`

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Results UI |
| GET | `/api/metrics` | Daily metrics JSON |
| POST | `/api/sync` | Incremental chain index + recompute |
| POST | `/api/reset` | Clear index (then Sync/backfill again) |
| GET | `/api/health` | Sync status |

If numbers look low vs Dune, use **Rebuild** in the UI (or `POST /api/reset`) then run `npm run backfill` until `idle`.

## What is indexed

Same Dune tables (on-chain events, not app D1):

- `arcadex_celo.arcadextxhub_evt_signedin`
- `arcadex_celo.arcadextxhub_evt_entrypaid`
- `arcadex_celo.arcadexrewards_evt_checkedin`
- `arcadex_celo.arcadexrewards_evt_spinresultgranted`
- `arcadex_celo.arcadexrewards_evt_onchainrewardclaimed`
- `arcadex_celo.sparkrefill_evt_entrypaid`
- `arcadex_celo.scoresubmit_evt_entrypaid`
- `arcadex_celo.infinitespark_evt_entrypaid`
- `erc20_celo.evt_transfer` (USDT/USDC into SparkRefill / ScoreSubmit / InfiniteSpark, `value >= 50000`)
