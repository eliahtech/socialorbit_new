> **Superseded 2026-11-17:** the Phase 2 billing work and Vercel adaptation described as blocked below were implemented in v0.3.0. The lockfile and dependency install gate remains open because it needs network access.

# SocialOrbit billing/security upgrade — gate report

**Date:** 2026-11-16  
**Result:** **BLOCKED AT PHASE 0** (the specification explicitly forbids beginning a subsequent phase without a green full gate).  
**Starting source:** user-provided `socialorbit-pro.zip`, version 0.2.0.  
**Current package:** 0.2.1-baseline (toolchain/CI baseline fixes only).

## Architecture — ten-line assessment from the existing source

1. The application is a pre-production TypeScript/Node Express API with a vanilla-JS static creator/admin frontend.
2. `apps/api/src/server.ts` registers public, workspace-scoped, admin, OAuth, billing, and payment webhook routes.
3. Authentication verifies Supabase Auth bearer tokens; tenant role checks query `workspace_members`.
4. Supabase Postgres with SQL migrations implements plans, users, content, publishing jobs, credits, and RLS policies.
5. Supabase Storage holds temporary media with a designed 100 MiB per-file cap and seven-day expiry.
6. The BullMQ/Redis worker dispatches publication/FFmpeg clip tasks and periodically handles cleanup and subscription expiry.
7. The social subsystem includes Facebook, Google/YouTube and LinkedIn OAuth; publishing is implemented only for limited Facebook text/YouTube video adapters.
8. AI text adapters support OpenRouter, Gemini, and Groq; graphics editing uses browser canvas.
9. Existing billing uses direct Daraja M-Pesa plus Pesapal; one-off checkouts are intended to grant subscription periods or credit packs.
10. Capacitor currently has configuration only; there is no verified native Android or iOS build or deployed production stack.

## Phase gate status

| Phase | Status | Evidence / reason |
|---|---|---|
| 0 — baseline/toolchain | **Partial / blocked** | Versions pinned; cross-platform test command verified; cannot generate npm lockfile or run full typecheck without npm dependencies |
| 1 — database + RLS | **Not started** | Full gate from Phase 0 is not green; no local Postgres/Supabase available |
| 2 — Pesapal + PayPal + multicurrency | **Not started** | Blocking Phase 0 gate; existing direct Daraja code remains in this snapshot, do not deploy it as the desired design |
| 3 — API correctness | **Not started** | Blocking Phase 0 gate |
| 4 — security hardening | **Not started** | Blocking Phase 0 gate |
| 5 — worker, frontend, E2E | **Not started** | Blocking Phase 0 gate |
| 6 — real provider sandbox verification | **Not started** | Blocking Phase 0 gate; credentials and provider test accounts unavailable |
| 7 — final release readiness | **Not started** | No validated production release |

## Commands actually executed

```text
node -v                                   -> v22.16.0
npm -v                                    -> 10.9.2
npm install --no-audit --no-fund ...       -> timed out (npm registry unavailable)
npm install --package-lock-only --offline -> ENOTCACHED (@capacitor/android)
npm ci --offline --no-audit --no-fund      -> failed (missing package-lock.json)
npm run typecheck                         -> failed TS2688: missing node type definitions
npm test                                  -> 21 passed, 0 failed
npm run test:syntax                       -> passed
node --check apps/web/public/app.js       -> passed
node --check apps/web/public/admin.js     -> passed
node --check apps/web/public/landing.js   -> passed
node --check apps/web/public/sw.js        -> passed
```

None of the 21 source-level tests verify database migrations, actual payments, OAuth, or external publication. Full gate **not green**.

## Bugs and issues found

| File | Problem | Current change | Evidence / remaining work |
|---|---|---|---|
| `package.json` | No toolchain pin and test command used a shell wildcard | Pin Node v22.16.0/npm v10.9.2; use Node test discovery | `npm test`: 21 pass locally |
| `.nvmrc` | Missing | Added `22.16.0` | File checked; not a runtime installation |
| `.github/workflows/ci.yml` | Used non-reproducible `npm install` | Switched to `npm ci` and Node from `.nvmrc` | Requires an actual committed lockfile; CI not run |
| `package-lock.json` | Missing | **Unfixed**: network/cache unavailable | `npm ci` fails; cannot truthfully claim reproducible install |
| `supabase/migrations/002_payment_fulfillment.sql` and `003_extended_features.sql` | Both redefine `fulfill_verified_payment` | **Unfixed**: Phase 1 blocked | Requires clean database and concurrency/RLS integration tests |
| `apps/api/src/services/payments.ts` and `routes/billing.ts` | Direct Daraja branch and hard-coded KES, contrary to new spec | **Unfixed**: Phase 2 blocked | Requires full gate before edits and provider integration tests |
| `apps/api/src/routes/webhooks.ts` | No PayPal webhook verification / reconciliation | **Unfixed**: Phase 2 blocked | Provider sandbox and API/database tests required |
| `apps/api/src/server.ts` | Express app auto-listens; testing cannot import it without listening | **Unfixed**: Phase 3 blocked | Export app separately; run request tests after dependencies available |
| `apps/api/src/middleware/auth.ts` | Admin MFA AAL2 not enforced by middleware | **Unfixed**: Phase 4 blocked | Implement and integration-test with Supabase Auth |

## Verified provider documentation reviewed (design only, no code claim)

- PayPal REST Orders v2 create/capture: https://developer.paypal.com/platforms/checkout/standard/integrate
- PayPal webhook events: https://developer.paypal.com/payment-methods/webhooks/
- PayPal webhook signature verification: https://developer.paypal.com/api/rest/webhooks/rest/
- Pesapal API 3 SubmitOrderRequest: https://developer.pesapal.com/how-to-integrate/e-commerce/api-30-json/submitorderrequest
- Pesapal status query (lists `MPESA` as possible payment method): https://developer.pesapal.com/how-to-integrate/e-commerce/api-30-json/gettransactionstatus

Provider API documentation was checked, **not tested against real accounts**. Merchant availability for PayPal and specific Pesapal currencies/payment methods must be verified with the owner's accounts.

## Exact unblock checklist

1. On a computer/CI runner with network access, unzip the package and run **Node 22.16.0/npm 10.9.2**.
2. From the repository root: `npm install --no-audit --no-fund`.
3. Confirm that `package-lock.json` exists and commit it to version control.
4. Run **`npm ci && npm run typecheck && npm test && npm run test:syntax`**. Fix real typecheck errors (without disabling checking or using unreviewed `any` bypasses).
5. Supply a disposable Supabase project or local PostgreSQL/Supabase CLI stack; apply migrations 001–003 and run fresh-DB/RLS tests before modifying payment tables.
6. For Phase 2, set up Pesapal and PayPal **sandbox** merchant accounts and webhook endpoints; test with sandbox credentials in a secret store, never in chat/source.
7. For later phases, supply dedicated Redis, FFmpeg, approved social test accounts, and Android/iOS toolchains.

## Paid pilot verdict

**Not suitable for paid pilot.** The full gate fails, production billing architecture does not meet the new specification, and live payment/database/platform testing has not been executed.

This report deliberately stops at Phase 0 as the uploaded upgrade prompt requires. The user-approved new billing architecture remains the target but must not be represented as shipped.

## Addendum: Node version change

Runtime target changed from 22.16.0 to **Node.js 26.x** (latest version listed on Vercel). Also: exact npm pin and `packageManager` removed, `@types/node` set to `^26.0.0`, `--experimental-strip-types` removed from `npm test`. Verified here on Node v22.23.4: `npm test` 21 pass, `npm run test:syntax` pass. **Not verified on Node 26**, and `npm ci`/`typecheck` still need a networked machine.
