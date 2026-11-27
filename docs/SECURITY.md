# Security checklist and trust boundaries

## Present in code

- Supabase-authenticated access token verification on server-side tenant routes.
- Explicit tenant role checks on workspace operations and admin-only routes for global operations.
- Row Level Security enabled on relevant database tables; direct client writes are intentionally limited.
- OAuth HMAC state verification; AES-256-GCM storage of provider tokens with a server-only encryption key.
- Browser security headers, API rate limiting, JSON request-size cap, zod request validation.
- Private Storage bucket, time-limited signed upload URLs and server verification of stored object metadata.
- Payment callback status is verified through an authenticated provider query; successful browser redirects alone never grant entitlements.
- Idempotent SQL credit reservation/settlement/release; emergency publishing-pause control.
- Worker avoids automatic retries on ambiguous external publishing results.

## Before production

- Exercise RLS with a real database using multiple tenant users and revoked members. SQL migrations not yet executed in this environment.
- Penetration test OAuth state/session replay, account removal during callbacks, token expiry and webhook authenticity.
- Validate all provider-specific content security rules and required scopes using approved apps.
- Review the REST API's use of Supabase service-role privileges and enforce consistent authorization for every newly added route.
- Make content scanning, malicious file detection and server-side MIME sniffing robust; current upload validation relies on type allowlist and verified metadata size, not full antivirus.
- Review browser CSP third-party scripts and implement SRI/version pinning where appropriate.
- Require MFA for all administrators; enforce email verification and session policies.
- Define payment dispute, refund, tax and data retention policies.
- Provide backups, encryption-key management, incident response and verified deletion mechanisms.
- Complete GDPR/Kenya Data Protection Act and other applicable privacy/legal review before accepting personal data commercially.

This document does not certify the system secure. It captures the current baseline and its gaps.
