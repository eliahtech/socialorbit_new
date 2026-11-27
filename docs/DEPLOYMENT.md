# Deployment and infrastructure preparation

**Not yet deployed.** Do not enable payment collection or publishing in production before completing the release gates.

## Deploying to Vercel

Architecture: **static site on Vercel's CDN + Express API as one Vercel Function + Supabase**, with an optional separate worker host.

| Piece | Where | Notes |
|---|---|---|
| `apps/web/public` | Vercel CDN (`outputDirectory`) | Security headers come from `vercel.json` |
| `api/index.ts` -> `apps/api/src/app.ts` | Vercel Function (`maxDuration` 60 s) | `/api/*` and `/billing-return` are rewritten to it |
| Daily maintenance | Vercel Cron -> `/api/cron/maintenance` | Media expiry cleanup and plan-period expiry. Needs `CRON_SECRET` |
| Scheduled publishing, social sync | **No worker host needed**: `PUBLISH_VIA_CRON=true` plus a frequent cron (Vercel Pro, or Supabase `pg_cron` calling the endpoint every minute) | The optional BullMQ worker (`npm run worker`, needs Redis) still works if you prefer a queue |
| Rate limiting | Upstash Redis REST (`UPSTASH_REDIS_REST_*`) | Without it, limits are per-instance and weak |

### Steps

1. Run `npm install` on a networked machine, commit the generated `package-lock.json`.
2. Create the Supabase project; run `supabase/migrations/001`-`007` in order; create the private bucket `socialorbit-media`. Enable TOTP MFA (Auth -> Multi-factor) and set a minimum password length of 8 or more.
3. Import the repo into Vercel (Framework Preset: Other). `vercel.json` sets the build command and output directory. Confirm the Node.js version in Project Settings matches `engines` (26.x); use 24.x if 26 is not offered.
4. Set environment variables (see `.env.example`): at minimum `PUBLIC_BASE_URL` (your https production origin, no trailing slash), `SUPABASE_*`, `ENCRYPTION_KEY_HEX`, `CRON_SECRET`, and Upstash variables. Add Pesapal and/or PayPal variables to enable checkout; the UI only offers configured methods.
5. Deploy a **preview** first and check `https://<preview>/api/health?deep=1` (should report `database: ok`), then sign in, then `/app.html#billing`.
6. Register the callbacks listed below, test in sandbox, then switch `*_ENV=live`.

### Callback URLs

- OAuth redirect URIs: `<PUBLIC_BASE_URL>/api/oauth/callback/facebook`, `/youtube`, `/linkedin`.
- Supabase Auth redirect URLs: `<PUBLIC_BASE_URL>/app.html`.
- Pesapal: register an IPN for `<PUBLIC_BASE_URL>/api/webhooks/pesapal` (GET or POST) and set `PESAPAL_IPN_ID`.
- PayPal: webhook `<PUBLIC_BASE_URL>/api/webhooks/paypal`, event `PAYMENT.CAPTURE.COMPLETED`; set `PAYPAL_WEBHOOK_ID`. Return URLs are generated automatically.

### Cron schedules and plans

`vercel.json` ships one **daily** cron, which is the maximum frequency on Vercel's Hobby plan. If you are on Pro and want publishing without a worker, set `PUBLISH_VIA_CRON=true` and add `{ "path": "/api/cron/publish-due", "schedule": "*/5 * * * *" }` to `crons`. Publishing jobs are claimed atomically, so a worker and cron can run together without double-posting. Since v0.4.0 nothing in the app needs FFmpeg, so no separate worker host is required.

### Admin MFA

Administrators must complete TOTP MFA (`ADMIN_REQUIRE_MFA=true`). On first visit to `/admin` the page walks the administrator through enrolling an authenticator app.

## Self-hosting alternative

`npm start` runs the same Express app with static serving from a persistent Node host. Optionally run `npm run worker` beside it (requires Redis).

## Configurations

- Configure Brevo SMTP in Supabase Auth, with a sender and SPF/DKIM.
- `scripts/build-web.mjs` bundles the Supabase browser client (no third-party CDN code) and generates `sitemap.xml`/`robots.txt` from `PUBLIC_BASE_URL` during the Vercel build.
- Enable `ENABLE_SOCIAL_SYNC` or `ENABLE_PUBLISHING` **only after** provider approvals, test accounts, compliance reviews and integration testing.

## Checks

```bash
npm install
npm run check
npm run dev           # API
npm run dev:worker    # optional, separately; Redis required
curl http://localhost:3000/api/health
```

A `health` status of `ok` only means the API process is responding; it is **not** a database/worker/provider integration readiness check. Verify these separately.

## Mobile

`apps/mobile/capacitor.config.ts` is a preliminary configuration. Generate and test Android/iOS platform projects using a machine with the required SDKs, compatible Capacitor versions, and actual device/simulator access. Apple builds and testing require an appropriate Mac and Xcode setup. Do not distribute until app-specific store compliance and purchase rules are implemented.

## Rollback and monitoring

Keep migration backups, environment snapshots, signed deployment revisions and worker queue telemetry. Before release, define automated alerts and an incident escalation path for duplicate publications, credit inconsistencies, payment reconciliation failures, OAuth failures and expired media cleanup. A production operational runbook is not yet complete.

## Node.js version (Vercel)

- Target runtime: **Node.js 26.x**. Vercel lists 26.x (default) and 24.x as available, and only major versions can be selected; minor/patch updates roll out automatically. `engines.node` is `26.x` and `.nvmrc` is `26`.
- Node 26's built-in `fetch` negotiates HTTP/2 on Vercel Functions. The payment, OAuth and social-provider calls use `fetch`, so test them in staging. To fall back to HTTP/1.1 set `VERCEL_FETCH_DISABLE_H2=1` and redeploy.
- Vercel only hosts the static site and (after a serverless adapter is written) the API. The BullMQ worker must run on a separate long-lived host using the same Node major version.
- `npm test` runs `node --test` without `--experimental-strip-types`, which relies on Node's default TypeScript type stripping (Node 22.18+ and 26). It passed on v22.23.4 here and has NOT yet been run on Node 26.

## Migration 005 (remove clips, add links) — read before applying to an existing database

- It **aborts** if any workspace holds purchased top-up credits in a `clips` wallet, so nothing paid-for is destroyed silently.
- It replaces the signup trigger and payment function first, releases any reserved clip credit, deletes the (empty) `clips` wallets, then tightens the wallet constraint and drops `plans.clips`.
- `credit_transactions` history is untouched, and the inert `clip_projects` table is left in place (drop later with `drop table public.clip_projects;` if you do not need the history).
- Back up first (Supabase dashboard -> Database -> Backups), then run it in the SQL editor.
- Google scopes: see "Publishing to YouTube" below (v0.5.0 uses `youtube.readonly` plus `youtube.upload`).

## Troubleshooting a blank or unresponsive page

Open `/diagnose.html` on your deployment. It checks, without showing secrets: that `/app.js` is served as JavaScript, that `/vendor/supabase.js` was built, that the API function responds, that the database is reachable, and that Supabase is configured. Use "Copy report" and share the result. The app also shows a red banner at the bottom of the screen if a script fails to load or the app does not start within 8 seconds.

## The API bundle (`api/_app.js`)

Vercel runs `api/index.js`, a small loader that imports `api/_app.js`. `_app.js` is **generated**: `npm run build:api` compiles `apps/api` and `packages/core` (TypeScript, `.ts` import specifiers) into one plain ES module, leaving npm packages external. **After any change under `apps/api/src` or `packages/core/src`, run `npm run build:api` and commit `api/_app.js`.** CI fails if the committed bundle is stale. If the API cannot start, the loader returns `{"code":"STARTUP_FAILED","detail":"..."}` and `/diagnose.html` shows the detail.

## Generating ENCRYPTION_KEY_HEX

It must be exactly 64 hexadecimal characters (32 random bytes). Generate it once and keep a private backup: **changing it later makes every stored social-account token unreadable**, and users would have to reconnect.

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste the output into Vercel with no quotes, spaces or `0x` prefix, then redeploy. `/diagnose.html` shows whether the server considers the key valid.

## Publishing to YouTube and Facebook (v0.5.0)

**What works:** uploaded videos go to YouTube; uploaded images and text/link posts go to Facebook Pages; videos reach Facebook as links. YouTube's API has **no** text or image posts, so those are greyed out for YouTube destinations. A video that was already on a platform can still be shared by pasting its link.

**One-time setup**
1. Run migration `007_video_upload_visibility.sql` (it re-allows video types in the private bucket and adds the visibility setting; it supersedes `006`).
2. Vercel environment variables: `ENABLE_PUBLISHING=true`, and `GOOGLE_SCOPES=https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload`. Redeploy.
3. Google Cloud (the YouTube client's project): Google Auth Platform -> Data Access -> add the `youtube.upload` scope. Keep adding your own account under Audience -> Test users while in Testing mode.
4. In the app, **disconnect and reconnect YouTube** so Google asks for the new permission. Publishing is refused with a clear message until the upload permission has been granted.
5. Optional: `PUBLISH_VIA_CRON=true` plus a frequent cron if you want "Save & Schedule" to run without a worker. "Publish Now" works without either.

**Limits you must plan for**
- **Private until audited.** YouTube forces videos uploaded through an API project that has not passed Google's YouTube API Services compliance audit to Private, whatever visibility you choose. Apply for the audit before promising customers public uploads.
- **Quota.** Each upload costs about 1,600 of the default 10,000 daily quota units (roughly six uploads per day for the whole project) until Google grants more.
- **Verification.** `youtube.upload` is a sensitive scope. Testing mode (100 listed testers, tokens expire after 7 days) is fine for development; real customers need Google's app verification, which needs a domain you own.
- **Time and size.** An upload runs inside one Vercel function call (60 s as configured). Large videos on slow links may not finish; a dropped connection is marked "needs reconciliation" and is never retried automatically, so check YouTube Studio before re-posting.
- **Supabase storage.** The free plan caps each file at 50 MB; the app allows up to 100 MB (needs a paid plan and a raised limit in Storage settings).
- **Kids setting.** Uploads are declared "not made for kids". Change `selfDeclaredMadeForKids` in `packages/core/src/youtube.ts` if you publish children's content.
