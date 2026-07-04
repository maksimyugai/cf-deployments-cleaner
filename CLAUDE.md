# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single Cloudflare Worker (`src/index.ts`) with a cron trigger (`0 19 * * *`, i.e. 1:00 AM GMT+6) that nightly prunes old Cloudflare Pages deployments across every Pages project in the account:

- keeps the last `KEEP_PRODUCTION_COUNT` (default 3) production deployments per project, deletes the rest
- deletes all preview deployments

It talks directly to the Cloudflare REST API (`api.cloudflare.com/client/v4`) — no Cloudflare API client library, just `fetch`.

## Commands

```sh
npm install
npm run dev              # wrangler dev, exposes POST-able /__run for manual trigger
npm run test:scheduled    # invoke the scheduled() handler locally
npm run deploy            # wrangler deploy
npx wrangler tail         # stream logs from the deployed worker
npx tsc --noEmit          # typecheck
```

Secrets (not in `wrangler.toml`, set via `wrangler secret put <NAME>`):
- `CF_API_TOKEN` — needs "Cloudflare Pages: Edit" permission
- `CF_ACCOUNT_ID`

## Architecture

Everything lives in `src/index.ts`:

- `listAllProjects` / `listAllDeployments` — paginate the Pages API (25 per page) until a short page is returned.
- `cleanupProject` — splits a project's deployments into `production` vs `preview`, sorts production by `created_on` descending, and only the entries past index `KEEP_PRODUCTION_COUNT` are queued for deletion; all preview deployments are queued unconditionally.
- `deleteDeployment` — calls `DELETE .../deployments/{id}?force=true`. Cloudflare refuses to delete the currently live production deployment ("active production deployment" error) — this is expected and treated as a no-op skip, not a failure.
- `runCleanup` — iterates all projects; a failure on one project is caught and logged so it doesn't abort cleanup of the rest.
- Deletions are throttled with a fixed `DELETE_DELAY_MS` (300ms) sleep to stay under Cloudflare's account-wide API rate limit (1200 req / 5 min).
- `fetch()` exposes `/__run` purely for local manual testing via `wrangler dev`; it is not meant to be a public endpoint in production.
