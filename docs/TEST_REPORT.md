# Actual test and validation report

Date: 2026-11-16. Build: SocialOrbit 0.2.0, **pre-production**.

## Executed successfully in this environment

| Test | Result | Scope |
|---|---|---|
| `npm test` | **30 passed, 0 failed** (v0.4.0 snapshot) | Pure business rules, quotas, seven-day media expiry, scheduling, encryption, OAuth state, preflight, link validation, pricing/payment verification |
| `npm run test:syntax` | **Passed** | Node parser checks for `.ts` files in API, worker and core packages; not full TypeScript type checking |
| `node --check apps/web/public/app.js` | **Passed** | Browser JavaScript parsing only |
| `node --check apps/web/public/admin.js` | **Passed** | Browser JavaScript parsing only |
| `node --check apps/web/public/landing.js` | **Passed** | Browser JavaScript parsing only |
| `node --check apps/web/public/sw.js` | **Passed** | Service worker JS parsing only |

## Blocked / not executed

| Verification | Why |
|---|---|
| `npm install` | npm package registry inaccessible (DNS/network error); dependencies cannot be fetched |
| `npm run typecheck` | Not executable in this checkout because package dependencies / `@types/node` missing |
| Database migration execution and live RLS tests | No configured Supabase project access in test environment |
| Express endpoint integration tests | API dependencies unavailable; no running authenticated project |
| Redis publishing job integration | Redis, Supabase and approved provider accounts not connected |
| Payment provider end-to-end | No provider sandbox credentials or independent test transactions |
| Live Facebook/YouTube/LinkedIn OAuth | No client IDs/secrets or approved accounts |
| Live OpenRouter/Gemini/Groq calls | No credentials / paid usage authorization supplied |
| Browser and mobile E2E | Browser runtime blocked from local navigation; native SDK projects not generated |
| CI hosted run | Workflow authored but not pushed to a GitHub repository |
| Production deployment / penetration / load tests | No deployed staging or production environment |

**Interpretation:** 21 passed source-level tests are **not evidence that the whole SocialOrbit system is production-ready**. Mandatory release gates remain open until external testing, production security review, missing modules and mobile builds are complete.

Raw test output: `docs/test-output.txt`.

## 2026-11-16 upgrade attempt (0.2.1-baseline)

- `npm test`: **21 passed, zero failed** with cross-platform Node test discovery.
- `npm run test:syntax`: **passed**.
- `node --check` on `app.js`, `admin.js`, `landing.js`, and `sw.js`: **passed**.
- `npm ci --offline`: **failed**, no `package-lock.json` exists.
- `npm install --package-lock-only --offline`: **failed** (`ENOTCACHED` for `@capacitor/android`). Online `npm install` timed out because the registry could not be reached.
- `npm run typecheck`: **failed**, TS2688 because `@types/node` from uninstalled dependencies is missing.
- **No** live database, social, payment, Redis/worker or native mobile integration tests were executed.

The new upgrade specification forbids progressing past a failed gate. See `UPGRADE_GATE_REPORT.md` for detailed findings and exact unblock steps.
