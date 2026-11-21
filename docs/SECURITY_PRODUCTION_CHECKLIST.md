# Production security checklist

What protects Snap Notes in production, what only the owner can set or check, and what must be
done before accounts, sync and AI generation are switched on. Findings and evidence are in
[SECURITY_AUDIT.md](SECURITY_AUDIT.md).

Legend: ✅ verified in this repository · ☐ owner action · ⛔ release blocker

## 1. Release blockers

Do these before the GitHub variables `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` are set (which
is what turns accounts on for everyone).

- ⛔ ☐ **Merge `security/full-audit`** and let the deploy workflow publish it.
- ⛔ ☐ **Apply every migration to the hosted project**, including
  `20261120000000_security_hardening.sql`: `npx supabase@2.122.0 link --project-ref <ref>`, then
  `npx supabase@2.122.0 db push`. Then confirm in the SQL editor:
  `select key, value from snapnotes_private.settings;` returns six rows.
- ⛔ ☐ **Run the Security Advisor** (Dashboard → Advisors → Security Advisor, or
  `npx supabase@2.122.0 db advisors --linked --type security`). Expect no warnings or errors;
  INFO "RLS enabled, no policy" on `snapnotes_private.*` is intentional (deny-all).
- ⛔ ☐ **Email confirmation on**: Authentication → Sign In / Providers → Email → _Confirm email_.
  This also stops sign-up revealing which emails are registered.
- ⛔ ☐ **URL configuration**: Authentication → URL Configuration. _Site URL_
  `https://abbas-4.github.io/Snap-Notes/` (or the custom domain). _Redirect URLs_: only that
  address with `**`, nothing broad like `https://*.github.io/**` and no `localhost`.
- ⛔ ☐ **Custom SMTP** for auth emails (Authentication → Emails → SMTP Settings). The built-in
  sender is for testing and sends only a few emails an hour.
- ⛔ ☐ **Anonymous sign-ins off** and **manual linking off** (Authentication → Sign In / Providers).
  The database refuses anonymous sessions anyway; this keeps it that way at the source.
- ⛔ ☐ **Before enabling AI generation:** set a monthly **spending limit** in the Anthropic Console
  (Settings → Limits) on a workspace used only by Snap Notes, with usage alerts. This is the only
  limit that holds whatever happens to the database settings.
- ⛔ ☐ **Edge Function secrets** (`npx supabase@2.122.0 secrets set …`): `ANTHROPIC_API_KEY` (from
  that workspace; never in GitHub, the repository or a `VITE_` variable) and
  `AI_ALLOWED_ORIGINS=https://abbas-4.github.io`. Deploy as in [ai-generation.md](ai-generation.md);
  `supabase/config.toml` sets `verify_jwt = false` for this function on purpose: it checks every
  request's session with the auth server itself, which (unlike the gateway's signature check)
  also refuses signed-out sessions.
- ⛔ ☐ **Only the publishable key in GitHub**: the repository variable must be the
  `sb_publishable_…` (or legacy anon) key. The build refuses secret keys; the security check in
  CI fails on any secret in the output.

## 2. Verified protections (in the repository)

- ✅ Row Level Security on every `public` table; `authenticated` may only `SELECT` its own rows;
  `anon` has no table or function access; the private schema is unreachable. Guarded by schema
  tests in `src/cloud/hardening.integration.test.ts`.
- ✅ Every write and privileged action goes through `SECURITY DEFINER` functions with an empty
  `search_path`, taking the account from the token and checking its session still exists.
- ✅ Tokens from signed-out, revoked, forged or anonymous sessions are refused by every function
  and by the Edge Function.
- ✅ Account deletion needs a sign-in within ten minutes and affects only that account.
- ✅ Per-account storage limits (250,000 rows, 25 MiB of text) and per-push limit (500 changes).
- ✅ AI limits: 20/hour and 60/day per account; 150/hour and 500/day for the whole project;
  checked under a lock before any provider call; request size, card count and output tokens
  capped; provider timeout 60 s.
- ✅ No secret key in the browser bundle; the app refuses secret keys.
- ✅ Content Security Policy and `no-referrer` on the app; no inline script or `eval`; the app does
  not run inside a frame. The legacy app escapes all card data and has its own strict CSP.
- ✅ Documents are parsed only in the browser, with size, page, decompression and time limits.
- ✅ CI: pinned actions, read-only tokens, `npm audit`, signature verification, dependency review,
  gitleaks, CodeQL, Supabase Security Advisor, build security check, all tests.

## 3. Settings requiring owner verification

These cannot be seen from the repository. Check each in the Supabase Dashboard unless noted.

| Setting                                                                                  | Recommended                                                                    |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Auth → Sign In / Providers → Email: _Secure password change_                             | On (matches `secure_password_change = true` locally)                           |
| Auth → Sign In / Providers → Email: _Secure email change_                                | On (both addresses confirm)                                                    |
| Auth → Providers → Email: minimum password length / required characters                  | 8+, letters and digits (as local); longer is better                            |
| Auth → Email OTP / link expiry                                                           | 3600 s or less                                                                 |
| Auth → Rate Limits                                                                       | Defaults or lower for sign-ups, sign-ins, token verifications, emails          |
| Auth → Sessions: _Detect and revoke compromised refresh tokens_ (refresh token rotation) | On, reuse interval 10 s                                                        |
| Auth → Attack Protection: _Leaked password protection_ (paid plans)                      | On if available                                                                |
| Auth → Attack Protection: CAPTCHA (hCaptcha or Turnstile)                                | Recommended; needed in the app too (see §4)                                    |
| Database → Settings → SSL enforcement                                                    | On                                                                             |
| Database → Network restrictions                                                          | Restrict direct Postgres access to your own IPs (the API is unaffected)        |
| Project API keys                                                                         | Secret/service-role keys used nowhere outside Supabase; rotate if ever exposed |
| Organization → members                                                                   | MFA on every member's Supabase (and GitHub) account; more than one owner       |
| Edge Function `generate-flashcards` logs                                                 | Review `rate-limited` with `scope: project` events; raise limits deliberately  |
| Anthropic Console → data retention / privacy settings                                    | Reviewed; describe AI processing in a privacy notice                           |

**GitHub** (Settings):

| Setting                                              | Recommended                                                                                                                                                                                                                                     |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rules → Rulesets → new branch ruleset for `main`     | Require a pull request; require status checks _Lint, type-check, test, build_, _Integration tests…_, _Dependency vulnerabilities_, _Committed secrets_, _Analyze (javascript-typescript)_, _Analyze (actions)_; block force pushes and deletion |
| Code security → Dependabot alerts / security updates | On (currently off)                                                                                                                                                                                                                              |
| Code security → Dependency graph                     | On (currently off; the _Dependencies added by this pull request_ check skips with a warning until it is)                                                                                                                                        |
| Code security → Secret scanning and push protection  | On (already on)                                                                                                                                                                                                                                 |
| Code security → Private vulnerability reporting      | On                                                                                                                                                                                                                                              |
| Actions → General → Actions permissions              | Allow GitHub-made actions and selected actions (those in the workflows); require SHA pinning                                                                                                                                                    |
| Actions → General → Workflow permissions             | Read (already)                                                                                                                                                                                                                                  |
| Environments → `github-pages`                        | Deployment branches: `main` only (a custom policy exists; confirm it)                                                                                                                                                                           |
| Pages                                                | Source: GitHub Actions; _Enforce HTTPS_ on (already)                                                                                                                                                                                            |

## 4. Recommended improvements (optional)

- **Own origin (SN-05).** Serve Snap Notes from a custom domain (GitHub Pages → Custom domain,
  with a DNS CNAME), so other `abbas-4.github.io` sites cannot read its storage. Tell existing
  users to export or sign in first: browser storage does not follow to a new origin. Update the
  Supabase Site URL and redirect URLs, `AI_ALLOWED_ORIGINS` and `VITE_APP_URL`.
- **CAPTCHA on sign-up and password reset**, if automated sign-ups appear: enable it in Supabase
  and pass the token from the sign-up form (`options.captchaToken`); the CSP will then need the
  CAPTCHA provider's script and frame origins.
- **MFA (TOTP) for users**, if accounts come to hold sensitive material.
- **A host that can send headers** (for example Cloudflare Pages or Netlify) would allow
  `frame-ancestors`, `Permissions-Policy` and CSP reports. Not needed for the current risk.
- **Retire the legacy app** once nobody needs it for recovery: the React app already migrates its
  data on the same origin, so `/legacy/index.html` could be removed from the deploy.
- **Cheaper default model** (`AI_MODEL`) to lower the cost of each allowed request.

## 5. Changing the limits

Run in the SQL editor (they apply immediately, no deploy):

```sql
select key, value, description from snapnotes_private.settings order by key;
update snapnotes_private.settings set value = 1000 where key = 'ai_project_per_day';
```

Keys: `ai_per_hour`, `ai_per_day`, `ai_project_per_hour`, `ai_project_per_day`,
`storage_max_rows`, `storage_max_text_bytes`. Raise the provider spending limit before raising
the AI limits.

## 6. Security checks: maintenance

| Check                                      | Where                                  | Keeping it current                                                                      |
| ------------------------------------------ | -------------------------------------- | --------------------------------------------------------------------------------------- |
| Unit and integration security tests        | `ci.yml`                               | Add a test with each new table, function or rendering path                              |
| Schema guard (RLS, grants, functions)      | `hardening.integration.test.ts`        | Update its list of API functions when one is added on purpose                           |
| Supabase Security Advisor                  | `ci.yml` (integration job)             | Comes with the pinned CLI (`supabase@2.122.0` in `package.json` scripts); bump together |
| Build security check                       | `ci.yml`, `deploy-pages.yml`           | Add Supabase origins to `src/security/csp.ts` only if the app needs a new service       |
| `npm audit`, signatures, dependency review | `security.yml`                         | Dependabot PRs; fix or document any advisory that blocks                                |
| gitleaks                                   | `security.yml`                         | If a real secret is reported: rotate it first, then remove it from history              |
| CodeQL                                     | `codeql.yml`                           | Triage alerts under Security → Code scanning                                            |
| Pinned actions                             | all workflows                          | Only through Dependabot PRs; keep the `# vX.Y.Z` comments                               |
| Legacy app hash                            | `verify-legacy.mjs`, `verify-site.mjs` | Change only with a reviewed patch, updating both constants                              |

If a check blocks a pull request with a false positive, fix the cause or narrow the rule with a
comment explaining why; do not remove the check.
