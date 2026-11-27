# Engineering architecture

## Components

```text
Browser / planned Capacitor mobile app
                 |
           Bearer Auth
                 |
         Express TypeScript API
  Auth/RBAC · Workspaces · Content · Support · AI
  OAuth · Publishing · Billing · Analytics · Admin
       |          |              |
  Supabase    Provider APIs     Redis/BullMQ
 PostgreSQL   Social/AI/Pay     Publisher Worker
   Auth/RLS                       |
  Storage
```

## Tenancy and identities

An authenticated Supabase Auth `user_id` may belong to several `workspaces`. `workspace_members` defines `owner|admin|editor|analyst|viewer` roles. The service-role-backed API checks both the session and membership on tenant routes. RLS policies deny direct unauthorized tenant reads. `admin_roles` is a separate privileged table, bootstrapped through trusted administrative SQL.

## Data lifecycle

1. Creator creates `content_items` under a workspace.
2. Client requests signed upload from the authenticated server; the service checks mime and declared size, authorizes a private bucket path, and verifies actual uploaded bytes.
3. Uploaded `media_assets` receive a seven-day expiration; background cleanup removes expired objects and marks them deleted.
4. Approved platform endpoints can generate independent `publishing_jobs`; each reserves one quota unit with a unique idempotency key.
5. Worker claims each due job atomically and validates account credentials, media availability and provider capabilities again.
6. Completed provider responses are recorded in `publishing_jobs`/`publication_attempts`. Unknown external results go to `needs_reconciliation` and keep quota reserved until reviewed.

## Source detection

The worker can poll YouTube channel upload metadata and Facebook Page posts when OAuth credentials exist and social sync is explicitly enabled. Historic image backfill is excluded. Metadata alone is **not** valid authority to reuse original YouTube video files. This build records metadata but does not automatically redistribute unavailable originals.

## Payment trust boundary

Checkout creates a pending `payments` record with server-derived amount/plan. Provider callbacks prompt an **independent, authenticated status request** to the payment provider, and only the verified matching transaction calls `fulfill_verified_payment` for atomic subscription or credit-pack fulfillment. Do not grant access merely because of a redirect or user-supplied status.

## AI usage

Text generation is server-side through configured OpenRouter/Gemini/Groq-compatible adapters. Reserved credits are settled after success, released on definite failure. Image generation and AI highlight analysis are future modules. The local browser graphics editor is not the same as AI image generation.

## Deployment boundary

The API is currently structured as a long-lived Express entrypoint; it needs a serverless deployment adapter or persistent Node host for production. The optional job worker needs persistent hosting and Redis; the same jobs can instead run from the cron endpoints. No FFmpeg is required (video upload and clipping were removed). Supabase hosts Postgres/Auth/Storage; uploaded media is private and expiring.

## Failure behavior

- Ineligible provider: reject rather than simulate publication.
- External publication ambiguous: reconcile rather than auto-retry.
- AI provider unavailable: fail without settling unused text credits.
- Payment response unavailable: do not activate entitlements.
- Redis/worker unavailable: show queued jobs as pending; do not claim success.
