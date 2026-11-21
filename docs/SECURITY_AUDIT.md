# Snap Notes security audit

|                     |                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Assessment date** | 20 November 2026                                                                                            |
| **Audited commit**  | `db98b9b` (`main`, "Merge pull request #11 from abbas-4/m5-production-verification")                        |
| **Fixes**           | Branch `security/full-audit`                                                                                |
| **Target**          | OWASP ASVS 5.0.0 Level 2, used as a risk-based guide (not a certification; see [Limits](#scope-and-limits)) |
| **Companion**       | [SECURITY_PRODUCTION_CHECKLIST.md](SECURITY_PRODUCTION_CHECKLIST.md): owner actions and release blockers    |

## Summary

Snap Notes was already built with security in mind: Row Level Security on every table, all writes
through `SECURITY DEFINER` functions that take the account from the verified token, no secret
keys in the browser, a server-side AI allowance, and careful document parsing. The audit found
**no Critical issue**, **1 High**, **4 Medium**, **6 Low** and **6 Informational** findings.

The High finding (AI spending was capped per account but not overall, while accounts are free to
create) and three of the Medium findings are fixed on this branch with regression tests. The
fourth Medium finding (other sites on the shared `abbas-4.github.io` origin can read Snap Notes'
browser storage) cannot be fixed in code; it needs a custom domain, an owner decision.

Production today serves the **local-only** build: the deployed bundle contains no Supabase URL and
the repository has no Supabase variables, so accounts, sync and AI generation are not yet live.
The database, Edge Function and authentication findings are therefore pre-launch issues for
those features; the legacy-app XSS (finding 4) affects the live site today.

## Scope and limits

**In scope:** everything in the repository at the audited commit: the React app (`src/`), the
published original app (`legacy/index.html`), the four migrations and their functions, the
`generate-flashcards` Edge Function and its shared code, `supabase/config.toml`, the GitHub
Actions workflows and build scripts, and all dependencies. Read-only checks of the GitHub
repository settings, and passive requests to the public site (its pages and assets, as any
visitor downloads them).

**Testing method:** code review; adversarial tests against a local Supabase stack
(`supabase@2.122.0`: Postgres 17, GoTrue, PostgREST, Edge Runtime) with throwaway accounts;
jsdom tests of the legacy app with hostile data; a real browser against a production build
served locally; Supabase's own Security Advisor; `npm audit`, `npm audit signatures`, and a
full-history gitleaks scan.

**Not done, and why:**

- **The hosted Supabase project was not examined.** No credentials were available, and none were
  sought. Its Auth settings, network restrictions, keys and applied migrations must be checked by
  the owner ([checklist](SECURITY_PRODUCTION_CHECKLIST.md)); `supabase/config.toml` configures
  only the local stack.
- **No live AI calls.** The provider path was tested with a scripted provider; no paid request
  was made, and no Anthropic key exists in the local stack.
- **No active testing of production.** Only passive page and asset downloads; no scanning,
  fuzzing, authentication attempts or load.
- **Not a formal ASVS verification.** Requirements were applied where they fit the architecture;
  untested requirements are not claimed.

## Standards and sources

- OWASP Top 10:2025 (A01 Broken Access Control, A02 Security Misconfiguration, A03 Software Supply
  Chain Failures, A05 Injection, A06 Insecure Design, A07 Authentication Failures, A10 Mishandling
  of Exceptional Conditions were most relevant).
- OWASP ASVS 5.0.0 (published 30 May 2025), Level 2, and the OWASP Cheat Sheet Series (XSS
  prevention, Content Security Policy, Session Management).
- Supabase: production security checklist, Row Level Security, Edge Function authentication, and
  the _Sessions_ guide, which recommends checking a token's `session_id` against `auth.sessions`
  to refuse tokens from signed-out sessions.
- GitHub Actions secure use: full-length SHA pinning, least-privilege `GITHUB_TOKEN`, avoiding
  `pull_request_target`.
- Vite: `VITE_`-prefixed variables are embedded in client code and must not hold secrets.

## Threat model

**Assets:** users' private study data (cards, progress, study history); account credentials and
sessions; the owner's AI provider budget and Supabase quotas; the integrity of the published
site and its build pipeline.

**Trust boundaries:**

```
Browser (untrusted)                     Supabase (trusted)                  Third parties
┌──────────────────────────┐  HTTPS    ┌──────────────────────────────┐    ┌────────────────┐
│ React app + legacy app   │──────────▶│ GoTrue (auth)                │    │ Anthropic API  │
│ localStorage: data,      │  JWT      │ PostgREST → SECURITY DEFINER │    │ (study text)   │
│ session (refresh token)  │──────────▶│   sync_pull/push, delete,    │    └───────▲────────┘
│ PDF/DOCX parsed locally  │           │   ai_generation_begin        │            │ server key
└──────────▲───────────────┘           │ Edge Function ───────────────┼────────────┘
           │ same origin               └──────────────────────────────┘
┌──────────┴───────────────┐           GitHub: Actions build → Pages artifact → abbas-4.github.io
│ other abbas-4.github.io  │
│ project sites            │
└──────────────────────────┘
```

**Attackers considered:** an anonymous internet user; a signed-up user attacking other accounts or
the shared budget; someone creating many accounts; a person who obtains a victim's token (shared
computer, malware, XSS); a malicious import file or document; a compromised dependency, CDN or
GitHub Action; malicious text in study material aimed at the AI model.

## What already worked well

- Every API table has RLS, read-only grants to `authenticated` and none to `anon`; all writes go
  through functions that use `auth.uid()` and a fixed empty `search_path`. Verified live: cross-
  account reads, writes, forged user IDs and direct table writes are all refused.
- No secret in the browser: the app refuses `sb_secret_…`/`service_role` keys; the published
  bundle contains no secret (checked passively); git history has no leaks (gitleaks).
- The Edge Function validates size and shape before parsing, authenticates through the auth server
  (which refuses revoked sessions), reserves quota before calling the provider, treats study
  material as delimited data, validates the model's reply against a schema, and drops ungrounded
  cards. Errors never leak internals; logs carry no study text.
- The React app has no HTML sinks (`dangerouslySetInnerHTML`, `innerHTML`, `eval`); user, imported,
  extracted and AI-generated text is rendered as text (verified in a browser with script
  payloads that synced through the server).
- Document parsing is local, type-checked by magic bytes, size-capped before and during
  decompression, CRC-checked, refuses DOCTYPEs (entity expansion), and runs PDF.js with
  evaluation and XFA off.
- Account deletion requires a sign-in within ten minutes; the sign-in UI avoids enumeration;
  sessions use PKCE and refresh-token rotation.

## Findings

Severity combines impact and likelihood for this application. "Confirmed" means reproduced on the
local stack or in tests; each fix has a regression test that fails without it.

| ID    | Severity      | Finding                                                                  | Status                          |
| ----- | ------------- | ------------------------------------------------------------------------ | ------------------------------- |
| SN-01 | High          | AI spending capped per account only; new accounts reset it               | Fixed (+ owner actions)         |
| SN-02 | Medium        | Tokens from signed-out sessions still accepted by the database API       | Fixed                           |
| SN-03 | Medium        | No storage limit per account                                             | Fixed                           |
| SN-04 | Medium        | Stored XSS in the published legacy app, on the app's own origin          | Fixed                           |
| SN-05 | Medium        | Shared `abbas-4.github.io` origin exposes browser storage to other sites | Open: owner decision            |
| SN-06 | Low           | No Content Security Policy, referrer policy or framing protection        | Fixed (within Pages' limits)    |
| SN-07 | Low           | CI: mutable action tags, persisted credentials, no security gates        | Fixed                           |
| SN-08 | Low           | `main` unprotected; Dependabot alerts off                                | Open: owner action              |
| SN-09 | Low           | Password change did not require a recent sign-in                         | Fixed locally; owner for hosted |
| SN-10 | Low           | PDF reading had no time limit                                            | Fixed                           |
| SN-11 | Low           | Legacy stylesheet loaded from a CDN without integrity check              | Fixed                           |
| SN-12 | Informational | Moderate advisory in a lint-only dependency (not shipped)                | Fixed (lockfile)                |
| SN-13 | Informational | Sign-up reveals registered emails when confirmations are off             | Owner: enable confirmations     |
| SN-14 | Informational | Edge Function CORS allows any origin by default                          | Owner: set allowed origins      |
| SN-15 | Informational | Local data stays after sign-out unless the user opts to remove it        | By design, documented           |
| SN-16 | Informational | Prompt injection through study material                                  | Mitigated; residual noted       |
| SN-17 | Informational | Study material is processed by a third-party AI provider                 | Disclosed; owner policy         |

### SN-01 (High): AI spending was capped per account, not overall

**Affected:** `supabase/migrations/20261116000000_ai_generation_quota.sql` (`ai_generation_begin`),
`supabase/config.toml` (open sign-up).
**Impact:** each account could make 60 generation requests a day, each up to ~30,000 characters
of input and 16,000 output tokens on the default model. Sign-up is open, and the local config has
email confirmation off; with the same on the hosted project, scripted sign-ups would each bring a
fresh allowance, making the owner's provider bill unbounded. (OWASP A06, ASVS business-logic and
anti-automation requirements.)
**Evidence:** design review, and the existing integration test asserting that "another account
has its own allowance". No paid request was made.
**Fix:** `20261120000000_security_hardening.sql` adds a project-wide limit (150 requests per
rolling hour, 500 per rolling day by default) enforced in the same transaction, under one advisory
lock so parallel requests cannot overshoot; anonymous sessions are refused. The Edge Function
explains a project-wide pause distinctly. Limits are in `snapnotes_private.settings`, adjustable
without a migration.
**Tests:** `hardening.integration.test.ts` ("caps requests across all accounts together", a fresh
account cannot get around it, 15 parallel requests from three accounts get exactly the cap,
30 parallel requests from one account get exactly its 20); `handler.test.ts`,
`supabaseAccess.test.ts`.
**Owner actions (release blockers for AI generation):** a spending limit on the Anthropic
workspace; email confirmation on; CAPTCHA recommended. See the checklist.

### SN-02 (Medium): signed-out sessions' tokens still accepted by the database API

**Affected:** `sync_pull`, `sync_push`, `delete_account`, `ai_generation_begin`.
**Impact:** an access token stays validly signed until it expires (up to one hour). After _Sign
out on every device_, a token copied from a shared computer or by malware could still read and
overwrite all of the account's data, and within ten minutes of the victim's sign-in could delete
the account. (A07, ASVS session termination.)
**Evidence:** reproduced locally: after a global sign-out the auth server refused the token, but
all four database functions accepted it, including account deletion.
**Fix:** every API function now calls `snapnotes_private.current_account()`, which also requires
the token's `session_id` to exist in `auth.sessions` for that user and not be past `not_after`, as
Supabase's sessions guide recommends. The app already treats the resulting `28000` error as "your
session has ended" and signs out.
**Tests:** revoked (global and single-device), missing, unknown, borrowed and malformed sessions
are refused by every function and the Edge Function; other devices keep working; the app's own
client reports an auth error.

### SN-03 (Medium): no storage limit per account

**Affected:** `sync_push`.
**Impact:** one free account could store data without limit (a single 40 MB request was accepted
in 2.5 s locally). Filling the database disk puts a hosted project into read-only mode, an outage
for every user. (A06, ASVS resource-limit requirements.)
**Fix:** `sync_push` measures the account once per push and rejects new or changed records, one
by one, past 250,000 rows or 25 MiB of text (defaults in `snapnotes_private.settings`). Deletions
are always accepted. Rejected records stay on the device, which the app already reports; nothing
stored is touched. The existing 500-changes-per-push and per-field limits remain.
**Tests:** row limit, byte limit, deletions still accepted past the limit, accounts counted
separately.
**Residual:** limits are per account; many accounts can still use more in total (mitigated by
sign-up rate limits, email confirmation and CAPTCHA on the hosted project).

### SN-04 (Medium): stored XSS in the published legacy app

**Affected:** `legacy/index.html`, published at `/Snap-Notes/legacy/index.html`.
**Impact:** the original app built HTML from card fields and IDs with incomplete or no escaping, in
several views. Its cards can come from an import file, so a crafted "deck" shared with a user
would run script when viewed. The page shares its origin with the React app, so that script could
read the React app's stored data and its Supabase session. Live on production today. (A05.)
**Evidence:** `src/ui/legacyAppSecurity.test.ts` loads the page in jsdom with hostile cards; all
four tests fail against the original file.
**Fix:** a minimal patch (19 lines): every interpolated value is HTML-escaped, IDs passed to
`onclick` handlers are JSON-encoded then escaped, a restrictive CSP (`connect-src 'none'`,
`default-src 'none'`) stops any injected script from sending data anywhere, and the stylesheet
has Subresource Integrity. Behaviour and stored data are unchanged (verified in a browser: add,
list, edit, export). `verify-legacy.mjs` and `verify-site.mjs` now pin the patched file.

### SN-05 (Medium, open): shared origin with other GitHub Pages sites

**Affected:** hosting. Every project site of the `abbas-4` account is served from
`https://abbas-4.github.io` (today also `/Black-Jack/`). Browsers isolate storage by origin, not
path, so script on any of those sites can read and write Snap Notes' `localStorage`, including
the Supabase refresh token once accounts are enabled. Moving data to another browser storage API
would not help: they are all per origin.
**Current risk:** low in practice (the other site is a static page loading one script with SRI),
but it grows with every site added to the account and with each one's dependencies.
**Recommended fix (owner):** give Snap Notes its own origin, a custom domain such as
`snapnotes.example.com` configured in GitHub Pages, before enabling accounts. Users' existing
local data would need to move with them (export/import, or signing in to sync), because the new
origin starts with empty storage. Interim: keep no other interactive sites on this account.

### SN-06 (Low): no CSP, referrer policy or framing protection on the app

**Fix:** the production build now starts with a `<meta>` CSP (`script-src 'self'`, no inline
script or `eval`, `connect-src` limited to the site and the configured Supabase project,
`object-src 'none'`) and `referrer: no-referrer`. GitHub Pages cannot send headers, so
`frame-ancestors` and `X-Frame-Options` are impossible; `src/main.tsx` refuses to start the app
inside a frame instead. Verified in a browser: inline script, `eval` and third-party requests are
blocked, while sign-up, sync, PDF import and every page still work.
`scripts/verify-build-security.mjs` fails a build without the policy.

### SN-07 (Low): CI supply-chain hardening

**Fix:** every action pinned to a full commit SHA; `persist-credentials: false` on checkouts; job
timeouts and concurrency; new **Security** workflow (`npm audit` with production dependencies
blocking at any severity and all dependencies at high, `npm audit signatures`, dependency review
on pull requests, gitleaks on full history), **CodeQL** (JavaScript/TypeScript and Actions,
`security-extended`), the Supabase Security Advisor in the integration job, the build security
check in CI and deploy, and Dependabot for npm and Actions. Workflow permissions were already
read-only by default, and no workflow uses `pull_request_target`.

### SN-08 (Low, open): repository settings

`main` has no branch protection or ruleset, Dependabot alerts and security updates are off, and
any action may run. Secret scanning and push protection are already on. See the checklist.

### SN-09 (Low): password change without recent authentication

`secure_password_change` was off locally, so a stolen session alone could change the password
and lock the owner out. Now on in `supabase/config.toml`; all auth integration tests pass. The
hosted project's setting must be checked by the owner.

### SN-10 (Low): unbounded PDF processing time

A crafted PDF could keep PDF.js working indefinitely. `extractPdfText` now gives up after 60 s,
releases the document, and shows a clear message. Test: "gives up on a PDF that takes too long".

### SN-11 (Low): legacy stylesheet without integrity check

Fixed with `integrity`/`crossorigin` as part of SN-04.

### Informational

- **SN-12:** `minimatch` (moderate ReDoS, via ESLint and typescript-eslint) is used only by the
  linter on its own configuration; not reachable by users. Updated in `package-lock.json` by
  `npm audit fix` without changing `package.json`; lint, tests and build pass.
- **SN-13:** with email confirmation off, sign-up with a registered email returns an error, which
  reveals the account exists. With confirmation on (required for production), the answer is the
  same either way; the app's other screens already avoid enumeration.
- **SN-14:** the Edge Function's CORS default is `*`. Not a vulnerability, as every request needs
  the user's bearer token and no cookies are used; set `AI_ALLOWED_ORIGINS` anyway.
- **SN-15:** after sign-out, cards stay in the browser unless the user ticks "also remove my
  cards". A deliberate, disclosed local-first choice; shared-computer users are offered removal.
- **SN-16:** study material could contain instructions aimed at the model. Mitigated by delimiting
  and neutralising the material, a system prompt that treats it as data, a strict JSON schema,
  server-side checks that each card is grounded in the material, rendering as plain text, and
  the user reviewing every draft before saving. Residual: a crafted text can still lead to
  misleading cards in the author's own account, which is no gain for an attacker.
- **SN-17:** generation sends the user's material to Anthropic; the page names the provider
  first. The owner should describe this in a privacy notice and review the provider's data
  retention settings.

## Changes on this branch

| Area           | Files                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Database       | `supabase/migrations/20261120000000_security_hardening.sql` (new; no applied migration edited)                                              |
| Edge Function  | `supabase/functions/_shared/flashcards/handler.ts`, `supabaseAccess.ts`                                                                     |
| Auth config    | `supabase/config.toml` (`secure_password_change = true`; production note on confirmations)                                                  |
| Legacy app     | `legacy/index.html`, `scripts/verify-legacy.mjs`, `scripts/verify-site.mjs`                                                                 |
| Browser policy | `src/security/csp.ts`, `vite.config.ts`, `src/main.tsx`                                                                                     |
| Documents      | `src/documents/pdf.ts`, `extract.ts`                                                                                                        |
| CI             | `.github/workflows/ci.yml`, `deploy-pages.yml`, `security.yml`, `codeql.yml`, `.github/dependabot.yml`, `scripts/verify-build-security.mjs` |
| Dependencies   | `package-lock.json` (dev-only `minimatch` and ESLint patch updates)                                                                         |
| Tests          | `src/cloud/hardening.integration.test.ts`, `src/ui/legacyAppSecurity.test.ts`, `src/security/csp.test.ts`, updates to existing tests        |

## Tests performed

| Check                                         | Result                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `npm ci`                                      | Pass                                                                                             |
| `npm run lint`, `format:check`, `typecheck`   | Pass                                                                                             |
| `npm run check:functions` (Deno)              | Pass                                                                                             |
| `npm test`                                    | Pass: 918 tests in 74 files                                                                      |
| `npm run build` + `verify-build-security.mjs` | Pass (app and local-only builds; planted fake key caught)                                        |
| `npm run verify:legacy`, `verify-site.mjs`    | Pass (dist and assembled site)                                                                   |
| `npm run test:integration` (local Supabase)   | Pass: 61 tests in 6 files                                                                        |
| New hardening tests without the migration     | 10 of 14 fail, as expected (the 4 others guard existing protections)                             |
| Legacy XSS tests against the original file    | 4 of 4 fail, as expected                                                                         |
| Supabase Security Advisor (local, security)   | No warnings or errors (4 intentional INFO notices)                                               |
| `npm audit` (all / production)                | 0 vulnerabilities                                                                                |
| `npm audit signatures`                        | 280 packages verified                                                                            |
| gitleaks, full git history                    | No leaks                                                                                         |
| Browser, production build with CSP            | Sign-up, sync, card with script payloads (rendered as text), PDF import, legacy app, frame guard |
| Production site (passive)                     | HTTPS + HSTS; no CSP; no secrets or source maps in assets                                        |

## Remaining risks

- **Shared origin (SN-05)** until Snap Notes has its own domain.
- **Hosted configuration is unverified.** Every protection that lives in Supabase or Anthropic
  settings depends on the owner completing the checklist.
- **Many-account abuse** of storage and sign-up is limited by per-account caps and hosted rate
  limits, not eliminated; CAPTCHA is the next step if abuse appears.
- **Refresh tokens live in `localStorage`**, the Supabase JS default for a static site. Any XSS on
  the origin could take them; the CSP and React's escaping make that much harder, not impossible.
- **GitHub Pages limits:** no response headers, so no `frame-ancestors`, Permissions-Policy or
  CSP reporting.
- **Database limits are settings.** Anyone with database owner access can raise them; the
  provider spending limit is the backstop.
- **Third parties:** Supabase, GitHub, jsDelivr (legacy stylesheet, integrity-checked) and
  Anthropic are trusted.

## Release recommendation

- **The live site (local-only app and legacy app):** once this branch is merged and deployed, the
  stored XSS (SN-04) is fixed and the site has a CSP. No release blocker remains for the site as
  it is published today.
- **Turning on accounts, sync and AI generation:** with this branch merged, no Critical or High
  issue remains open in the code. The release blockers are owner configuration of the hosted
  Supabase project and the AI provider, listed in the checklist (apply the new migration, email
  confirmation, redirect allowlist, provider spending limit, among others). A custom domain
  (SN-05) is strongly recommended first.

**Verdict:** READY FOR PUBLIC LAUNCH WITH DOCUMENTED RESIDUAL RISKS, once this branch is merged and
the checklist's release blockers are complete. Until this branch is merged, the High finding
(SN-01) is unresolved for any deployment that enables AI generation.
