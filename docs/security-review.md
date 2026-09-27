# Security review — Phase 10 (2026-09-26)

Scope: RLS, authorization (pages, Server Actions, route handlers, database
functions), file access, server-side validation, browser hardening, and every
accepted risk in `docs/decisions.md`. Method: an inventory taken from the
running database and code (not from memory of what was built), the Supabase
security advisors on the hosted staging project, and a test for each finding
that failed before the fix and passes after it.

## Findings

| # | Finding | Severity | Status | Proof |
|---|---|---|---|---|
| F1 | `comments` table readable by anyone through the API: returned `user_id` (a stable id linking all of one customer's comments) and visible comments of hidden/archived products. The site itself only uses `product_comments()` (first names only). | Low–medium (privacy) | Fixed: migration `20260930100000_security_review.sql` — anon has no table access; signed-in users read only their own rows; moderators all. | `admin-dashboard.test.ts` "table itself is not public (F1)": fails with the old grant/policy planted, passes after. |
| F2 | Per-IP limits (OTP sends 10/h, existence lookups 30/h, failed verifications 30/h, logins 30/15 min) were keyed on the full IPv6 address. One machine normally holds a whole /64, so rotating addresses escaped every per-IP limit, leaving only the per-phone limits and the global daily budget, which an attacker could then exhaust and so block real sign-ups. | Medium (WhatsApp budget, availability) | Fixed: `src/lib/ip.ts` keys IPv6 by its /64 (IPv4-mapped → IPv4). | `otp.test.ts` "IPv6 /64 is one IP": 11 addresses in one /64 → 11/11 accepted when keyed raw (the bypass), 10 + `ip_hourly_limit` as the app keys it. Unit test `ip.test.ts`. |
| F3 | `pg_net` registered in schema `public` (advisor 0014). All its objects live in `net`; nothing was exposed, but the warning would stay on the client's dashboard. | Low | Fixed in the same migration (recreated in `extensions`). | Advisor re-run after applying (see below). |
| F4 | When the global OTP daily budget is used up, registrations and password resets are refused until midnight and nobody is told. That is exactly what a budget-burning attack looks like. | Medium (availability) | Fixed: `otp_budget_today()` (settings staff only) + a banner on every admin page from 80 %. | `admin-dashboard.test.ts` (F4, who can read it) and `tests/e2e/otp-budget-alert.spec.ts`; the e2e fails with the banner removed. |
| F5 | No Content-Security-Policy (debt since Phase 2). Supabase session cookies are readable by page scripts (the browser client needs them for Google linking), so any XSS could steal a session. | Medium | Fixed: per-request nonce CSP on every page (`src/lib/csp.ts`, `src/proxy.ts`). | `tests/e2e/csp.spec.ts`: every page × ar/en × role has zero violations with a fresh nonce; an injected `<script>` and `onerror` are blocked on public, customer and admin pages, and the same injection runs when the header is stripped (control). Plant: theme script without nonce → 82 page views fail. |
| F6 | HSTS relied on the host adding it. | Low | `Strict-Transport-Security: max-age=31536000` in `next.config.ts` (no `includeSubDomains`: the client's other subdomains are not ours). | Response headers in the e2e run. |
| F7 | Leaked-password protection (HaveIBeenPwned check) is off on staging (advisor). | Low | Launch runbook: enable on the production project (a Supabase Pro feature). | — |

New regression guards in `supabase/tests/04_security_coverage.test.sql`:
every SECURITY DEFINER function pins `search_path`; no view in `public`
bypasses RLS; anon cannot write any table. Each was planted (a definer
function without `search_path`, a plain view over `orders`, an anon column
grant) and failed, then passed after removal.

## Verified, no change needed

- **RLS inventory** (from `pg_class`, not the migrations): 22 tables in
  `public`, all with RLS and at least one policy; every `private` table has
  RLS and no API grants. The only `USING (true)` policies are read-only on
  `app_settings`, `order_statuses` and `order_status_transitions`, whose
  columns are all public by design (rate, KYC threshold, contacts, status
  names). Anon has no write privilege on any table (column grants included).
- **Definer functions:** 49 in `public`/`private`, all with `search_path`
  pinned. The advisors list 16 callable by `authenticated` and 1 by anon; each
  is on the explicit allowlist in the pgTAP test and checks its own
  permission inside (admin boundary tests, Phase 6). `product_comments` is
  the intended public view.
- **Pages:** every page under `/account` and `/admin` calls its own guard
  (`requireCompleteUser` / `requireAdmin(permission)` / `requireOwner`), not
  only the layout. No loading boundary above them (a missing permission is a
  real 404, Phase 9).
- **Server Actions:** each validates input with Zod on the server and checks
  the session/permission first; admin actions are enforced by a static test.
  Next checks the Origin of every action (CSRF).
- **Route handlers:** WhatsApp dispatch needs a ≥ 32-char bearer secret
  compared in constant time; the webhook verifies Meta's HMAC over the raw
  body before parsing, caps the body at 1 MB, and is replay-safe. The OAuth
  callback only redirects to fixed paths.
- **Open redirect:** `safeNext()` only accepts paths under the current locale,
  and next-intl prefixes the locale again (`//evil.com` becomes
  `/ar//evil.com`, a path on our site).
- **Files:** KYC and receipt buckets are private, JPEG only, 5 MB; photos
  are re-encoded server-side (EXIF gone); signed URLs live 60 s (KYC) and are
  rendered with a plain `<img>`, never through an image cache. The public
  bucket accepts only staff uploads to their own area's prefix.
- **Secrets:** the service-role client can be imported only by the modules on
  the ESLint allowlist; no secret is `NEXT_PUBLIC_*`.
- **Logs:** the 9 `console.*` calls in `src/` print error codes and
  categories, never phone numbers, codes, tokens or document data.
- **Client IP:** `x-real-ip` / `x-forwarded-for` are trustworthy only because
  Vercel overwrites them. Hosting anywhere else needs a proxy that does the
  same, or the per-IP limits can be forged (launch runbook).

## Supabase advisors on staging (security)

Run on 2026-09-26, before this migration was applied there:

| Advisor | Count | Assessment |
|---|---|---|
| RLS enabled, no policy (INFO) | 4 (`private.invoice_counters`, `message_events`, `otp_codes`, `rate_limit_events`) | Intended: deny-all tables used only by definer functions. |
| Extension in public (WARN) | 1 (`pg_net`) | F3, fixed. |
| SECURITY DEFINER executable by anon (WARN) | 1 (`product_comments`) | Intended public view; returns visible comments of visible products, first names only. |
| SECURITY DEFINER executable by authenticated (WARN) | 16 | Intended RPCs; each checks its permission inside; allowlisted in pgTAP. |
| Leaked password protection disabled (WARN) | 1 | F7, production setting. |

After applying `20260930100000_security_review` to staging (history version
recorded, matching the file): the `pg_net` warning is gone; the only new
entry is `otp_budget_today` under "executable by authenticated" (intended,
settings staff only, allowlisted in pgTAP). Everything else unchanged.

`pg_graphql`: not installed on staging (confirmed with `list_extensions`).

## Accepted risks, re-evaluated

| Decision (decisions.md) | Then | Now |
|---|---|---|
| Admin 2FA deferred (2026-09-23) | Accepted until launch. | **Recommend enforcing TOTP before launch** (below). |
| CSP as debt (2026-09-23) | Open. | Closed (F5). Enforced directly rather than report-only first: every page in both modes was checked with zero violations. |
| Account existence probing, 30 lookups/h per IP (2026-09-24) | Accepted. | Still accepted; the IPv6 hole is closed (F2). A distributed attacker (many IPv4 addresses) can still probe; the answer only reveals that a number is registered. If abuse shows up, add a challenge (Turnstile) to the registration step. |
| OTP global daily budget | Stops spending at 300/day. | Still right, and now visible (F4). An attacker with many IPs and numbers can still use it up and pause sign-ups for the day; that is the chosen trade-off (money over availability). |
| Displayed price may lag 5 min (Phase 4, ISR) | Accepted. | Better: pages now render per request and dashboard edits expire the catalog cache immediately (`updateTag`); the order still uses the live price. |
| ID documents deleted after review | Right call. | Unchanged; the reviewer alert (Phase 7) covers failed deletions. |
| Receipt fraud: residual risk stays with the admin | Accepted. | Unchanged: duplicate transaction numbers and image hashes are blocked, but only the bank app proves money arrived. |
| Audit log alterable by the Postgres superuser | Accepted. | Unchanged; only the client (project owner) holds that access in production. |
| Free tiers (no backups, pausing) | Development only. | Launch blocker: production needs Supabase Pro and Vercel Pro (runbook, client table). |
| Supabase cookies readable by scripts | Implicit. | Mitigated by the CSP (F5); required by the browser client for Google linking. |

## Admin 2FA: recommendation

**Enforce TOTP (authenticator app) for every staff account before launch.**

- **Why now.** The dashboard is live on staging with password-only staff
  sign-in. One phished or reused staff password gives, directly through the
  API and not just the UI: identity documents awaiting review, customers'
  names and phones, accepting receipts (moving orders to processing, which
  means handing out paid digital goods), price changes and, for the owner,
  staff management. Per-area permissions and the audit log limit and record
  the damage; they do not prevent it.
- **Cost.** Supabase MFA (TOTP) is free on every plan. The hook is already
  in place: every admin policy and function goes through
  `private.admin_assurance_ok()`, which today returns `true`. Enforcing it is
  one migration (`aal2` required in the JWT). The work is the enrolment page
  (QR code + first code), the code step after an admin signs in, a recovery
  path (the owner resets a staff member's factor; the developer resets the
  owner's by SQL) and tests (aal1 vs aal2 tokens at the API, e2e with codes
  computed from the secret using Node's built-in crypto, no new dependency).
  About 1–1.5 days.
- **Cost to staff.** An authenticator app on their phone (Google
  Authenticator, Microsoft Authenticator); a 6-digit code at sign-in. Customers
  are unaffected.
- **Rejected alternatives.** WhatsApp OTP for staff (costs money per sign-in,
  depends on Meta, weaker than TOTP); keeping the deferral (the risk above
  becomes real the day the client's staff start working).
- It depends on nothing from the client, so it can be done right after
  approval.
