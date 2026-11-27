# API inventory (implemented source routes, not live-certified)

The authenticated API expects `Authorization: Bearer <Supabase access token>`. Tenant routes use `:workspaceId` and the server verifies membership and role. Most responses are JSON; validation errors are standardized. Consult source route implementations for field-level contracts; a generated OpenAPI contract is still outstanding.

## Public and account

- `GET /api/health`, `/api/config`, `/api/plans`
- `GET /api/me`, `PATCH /api/me`
- `GET /api/workspaces`, `POST /api/workspaces`
- `GET /api/workspaces/:workspaceId/overview`, `GET/POST .../members`

## Creator workspace (prefix `/api/w/:workspaceId`)

- `/content` — list, create, update and delete content; drafts are genuine persisted data.
- `/media` — listing, request-upload, upload-completion validation.
- `/designs` — create and edit saved layered graphics.
- `/ai` — submit supported text tasks to centrally configured AI provider.
- `/social` — list authorized accounts; `/oauth/:provider/start`, account disconnect.
- `/publishing/jobs` — independent destination jobs, cancellation and status.
- `/automation` — create/list inactive rules (no live end-to-end automation engine).
- `/analytics` — stored job and available metric data, without simulated counts.
- `/billing` — subscription and wallets, credit packs, checkout and history.
- `/support` — support tickets, replies, suggestions and votes.
- `/api/notifications` — account notifications.

## Server-to-provider

- `/api/oauth/callback/:provider` — signed OAuth state callback and credential storage.
- `/api/webhooks/pesapal`, `/api/webhooks/paypal` — verification-first payment callbacks (never fulfil from the webhook body alone).
- `POST /api/w/:id/billing/checkout` — `{provider:'pesapal'|'paypal', currency:'KES'|'USD', purpose, plan|creditPackId}`; `POST /api/w/:id/billing/checkout/paypal/capture` — `{orderId}`.
- `/api/cron/maintenance`, `/api/cron/publish-due` — `Authorization: Bearer $CRON_SECRET` only.
- `GET /api/health?deep=1` — includes a database reachability check.

## Administrator

- `GET /api/admin/overview`, `/users`, `/workspaces`, `/tickets`, `/plans`, `/jobs`, `/features`
- `PATCH /api/admin/users/:id/status`, `/tickets/:id`, `/plans/:key`, `/features/:id`
- `POST /api/admin/publishing-pause`, `/tickets/:id/messages`

## Current provider-specific status

OAuth paths: Facebook Pages, YouTube channels, LinkedIn member authorization (require configured apps/permissions and have not been live tested).

External publication code paths: Facebook Page text, YouTube MP4 video only, **disabled by default**. No guarantee of live acceptance until provider approvals and sandbox/test-account verification. Instagram, TikTok, X, LinkedIn publishing, Facebook images/videos and other publishing features are not yet implemented.

## Content, media and publishing (v0.5.0)

- `POST/PATCH /api/w/:id/content` accept `link_url` (plain `https://` URL, no credentials, max 2048 chars; empty string clears it) and `visibility` (`private|unlisted|public`, used for YouTube videos).
- `POST /api/w/:id/media/request-upload` accepts JPEG, PNG, WebP, MP4, MOV and WebM up to 100 MB.
- `POST /api/w/:id/publishing/jobs` queues one job per destination. A destination that cannot publish the content is returned with an explanatory `error` (for example YouTube text or image posts, a missing upload, or a missing `youtube.upload` permission).
- `POST /api/w/:id/publishing/jobs/:jobId/run-now` publishes a queued job immediately inside the request (atomic claim; cannot double-post).
- Supported today: Facebook Page text, link and photo posts; YouTube video uploads.
