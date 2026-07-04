# cf-deployments-cleaner

A Cloudflare Worker that runs every night, goes through every Cloudflare Pages
project in the account, and deletes old deployments:

- **Production** — keeps the last 3 (by `created_on`), deletes the rest.
- **Preview** — deletes all of them.

Runs on cron trigger `0 19 * * *` (= 1:00 AM GMT+6).

## Setup

1. Create a Cloudflare API token with **Cloudflare Pages: Edit** permission (My Profile → API Tokens).
2. Install dependencies:
   ```sh
   npm install
   ```
3. Log in with wrangler (or use the token from step 1 directly):
   ```sh
   npx wrangler login
   ```
4. Set the secrets:
   ```sh
   npx wrangler secret put CF_API_TOKEN
   npx wrangler secret put CF_ACCOUNT_ID
   ```
5. Deploy:
   ```sh
   npx wrangler deploy
   ```

## Local testing

```sh
npm run dev
# in another terminal:
curl http://localhost:8787/__run
npx wrangler tail
```

Or invoke the scheduled handler directly:

```sh
npm run test:scheduled
```

## Configuration

- `KEEP_PRODUCTION_COUNT` (`wrangler.toml`, `[vars]`) — how many recent production deployments to keep (default 3).
- Cron schedule — `[triggers].crons` in `wrangler.toml`.

## Notes

- Cloudflare refuses to delete the currently active (live) production deployment via the API — the worker expects this and just logs it as a skip.
- Deletions are throttled with a ~300ms delay between requests to stay under Cloudflare's API rate limit (1200 requests / 5 minutes).
