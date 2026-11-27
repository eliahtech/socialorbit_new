# Honest implementation status — SocialOrbit 0.2.0

**Status:** PRE-PRODUCTION ENGINEERING BUILD. **NOT** a fully delivered, secure, tested, commercially launchable SaaS. "Implemented" below means source code is present, not that a live external end-to-end test passed.

| Module | Source code in this build | Validation status / missing work |
|---|---|---|
| Official logo, favicon, brand board, app icon | Yes | Files checked; image rendering/design QA not certified |
| Public responsive marketing pages | Yes | HTML/JS parser checks; browser E2E unavailable here |
| Creator workspace | Yes | API-wired screens; no live Supabase/browser E2E |
| Supabase Auth email/Google | Yes, SDK client wiring | Requires live Auth project, redirect and SMTP setup |
| Profiles, workspaces, roles and RLS | Yes, migrations + API | PostgreSQL migration execution and RLS penetration tests not run |
| Draft content and media library | Yes | Live Supabase storage verification needed |
| Signed uploads and 7-day cleanup | Yes | Worker/storage end-to-end test not run |
| AI text via OpenRouter/Gemini/Groq | Yes, configurable adapters | Live provider credentials and budget/latency verification needed |
| AI image generation | No | Planned; image credit wallet exists, no active image endpoint |
| Layered graphics editor | Yes, text/shapes, saved canvas and PNG export | Browser UI needs E2E and UX testing |
| AI video highlights/subtitles | No | Not implemented |
| Video clipping (FFmpeg) | **Removed in v0.4.0** | Not planned |
| Video upload + YouTube publishing | v0.5.0, streaming resumable upload; unit-tested with mocked provider responses | Not run against live YouTube; needs `youtube.upload` approval and API audit for public videos |
| Facebook photo posts | v0.5.0, Graph API `/photos` with a signed image URL; unit-tested with mocked responses | Not run against a live Page |
| Facebook link posts | Text + `link` field published via Graph API `/feed` | Not run against a live Page; needs Meta app review |
| Facebook Page OAuth | Yes | Provider approval and live scopes testing needed |
| YouTube OAuth | Yes | Provider approval and live scopes testing needed |
| LinkedIn OAuth | Yes | Live authorization/permissions test needed; publishing not wired |
| Instagram / TikTok / X OAuth | No | Not implemented; capability matrix only |
| Facebook Page text publishing | Yes, gated adapter | Disabled by default; live authorization/publication not tested |
| YouTube MP4 video publishing | Yes, gated adapter | Disabled by default; live authorization/publication not tested |
| Facebook Page image/video, Instagram/TikTok/X/LinkedIn publishing | No | Not implemented |
| New Facebook/YouTube content detection | Basic polling | Incomplete pagination, refresh/recovery, provider verification |
| Old video redistribution | Metadata intake only | No complete authorized-source reuse or slot executor |
| Evergreen and automatic redistribution | Inactive rules stored | Engine not implemented/activated |
| Independent publishing queue/credit reservation | Yes | Redis/Postgres/provider E2E not run; reconciliation UI pending |
| Content fingerprinting | Database schema | Full perceptual/video fingerprint engine pending |
| Advanced best-time analytics | No | Basic stored metrics only; no provider metrics collection |
| Social inbox | Database schema | No platform inbox sync/reply adapters |
| Translation | AI text task | No saved localization workflow/subtitles |
| Publishing risk checker | Basic technical preflight | No comprehensive policy/copyright engine |
| Subscriptions and AI top-ups | Schema, wallets, checkout API | Billing-cycle edge cases and provider sandbox tests outstanding |
| Pesapal and PayPal (KES/USD) verification | Server-side re-verification of amount, currency and reference before fulfilment; unit-tested pure logic | No sandbox or live transaction has been run |
| Super Admin dashboard | Basic operational controls | Needs full staff RBAC/UI/financial reporting, provider & quota controls |
| Support tickets and feature voting | API + UI | Live DB E2E and attachment support pending |
| Notifications | In-app API | Email/push delivery incomplete |
| PWA | Manifest/service worker | Browser installation tests needed |
| Android/iOS apps | Capacitor config only | Native app projects/builds not generated or tested |
| CI | Workflow definition | No remote CI run; dependencies not installed in environment |
| Security reviews | Baseline controls | No complete security audit or load testing |
| Legal pages | Prelaunch drafts | Require actual policies, lawful basis and owner review |

## Priority before any external paid pilot

1. Install dependencies, produce a lockfile, run full TypeScript compiler and fix any type errors.
2. Apply migrations to a clean Supabase project, execute per-role RLS tests, and validate private upload flow.
3. Set up Redis, run API and worker together and execute real browser E2E tests.
4. Complete robust OAuth refresh/revocation and confirm provider app approvals.
5. Exercise test publishing on real authorized test accounts; reconcile failures/partial success.
6. Test both payment providers using sandboxes, replay/collision checks, receipt/reconciliation flows.
7. Add mobile native projects and test actual devices.
8. Finish advanced features required by master specification; currently missing ones must not be sold as available.
9. Conduct independent security, privacy, performance and accessibility assessments.

See `MASTER_SPECIFICATION.txt` for the entire original 41-section feature request, retained in full.

## 2026-11-17 update (v0.3.0)

Implemented: Pesapal + PayPal with KES/USD (migration 004), removal of direct Daraja M-Pesa, Vercel layout and cron endpoints, admin MFA gate, Upstash-backed rate limiting, vendored Supabase client. Not yet verified: `npm ci` + full typecheck with dependencies installed, Vercel preview deployment, and sandbox payments. USD prices in migration 004 are proposed defaults.

## v0.4.0

Removed clip routes, FFmpeg worker, clip UI, YouTube upload branch and the `clips` credit kind (migration 005). Video MIME types are rejected by the media route. Facebook posts accept an https `link_url`. Known gap: social sync does not yet refresh expired YouTube access tokens (`refreshGoogleToken` is exported and ready to wire in).

## v0.5.0

Re-added video upload for YouTube publishing, Facebook photo posts, a per-destination compatibility check with reasons in the composer, YouTube visibility, "Publish Now", and recording of the scopes Google actually granted. The composer was exercised in a real browser against a mocked API (23 checks); the provider calls were exercised against mocked HTTP responses (7 checks).
