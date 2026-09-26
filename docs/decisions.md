# Decision log

One entry per meaningful architectural or product decision. Append only.

Format:
## YYYY-MM-DD — <decision>
- **Context:** why this came up
- **Decision:** what we chose
- **Alternatives rejected:** and why
- **Consequences:** cost, security, migration impact

---

## 2026-09-23 — Stack
- **Context:** bilingual transactional marketplace, solo developer, 45-day window, low running cost.
- **Decision:** Next.js (App Router) + TypeScript + Tailwind/shadcn, Supabase (Postgres/Auth/Storage/RLS), next-intl, Vercel, WhatsApp Cloud API direct.
- **Alternatives rejected:** WordPress (no fit for custom KYC/orders), self-managed VPS (more ops for a solo dev), Twilio Verify (~13x the message cost).
- **Consequences:** vendor dependency on Supabase/Vercel; RLS becomes the main security boundary.

## 2026-09-23 — Currency: USD pricing base, SDG charge, immutable fx snapshot
- **Context:** receiving bank accounts are SDG-only; the owner's supply costs (top-ups, Starlink, subscriptions) are USD and SDG moves quickly. Blocking for the schema (spec §12.1).
- **Decision:** variant prices are stored in USD. The owner sets one `usd_sdg_rate` in admin settings. At order creation the server reads the current price and rate and stores, as an immutable snapshot on the order: USD unit price, USD total, rate used, and the resulting SDG amount the customer pays. Invoices copy the order snapshot. Money is `numeric`, arithmetic in SQL only. Rounding rule for the SDG amount is fixed in the Phase 2 migration and tested.
- **Alternatives rejected:** SDG-only prices (owner re-prices the whole catalog by hand on every rate move); customer-selectable currency (there is no USD receiving account).
- **Consequences:** a rate change re-prices the catalog instantly for new orders and never touches existing orders/invoices. KYC threshold currency is settled in Phase 2 (default: USD, compared against the order's USD total, so it doesn't drift with the rate). Still pending client confirmation; if the client chooses SDG-only, the fx columns become constant rather than being removed.

## 2026-09-23 — WhatsApp interface + dev driver move to Phase 3
- **Context:** OTP (Phase 3) cannot work without a message sender; the roadmap had all WhatsApp work in Phase 7.
- **Decision:** the `WhatsAppService` interface and the dev driver land in Phase 3. The real Meta driver, webhook, retries and admin alerts stay in Phase 7.
- **Alternatives rejected:** building the Meta driver early (blocked on Meta verification and template approval, which the client owns).
- **Consequences:** the dev driver must be impossible to activate in production (boot-time env check), per CLAUDE.md rule 1.

## 2026-09-23 — Admin 2FA deferred (accepted risk)
- **Context:** spec §12.6. TOTP via Supabase MFA was recommended from day one.
- **Decision:** not in the MVP. No enrolment flow is built. `private.is_admin()` is written as a single function containing a clearly marked assurance-level check point, so enforcing `aal2` later is a one-line migration plus an enrolment UI, not a policy refactor. All admin RLS goes through `is_admin()` / `has_permission()`; no policy inspects admin rows directly.
- **Alternatives rejected:** day-one TOTP (scope/time within the 45-day window).
- **Consequences — accepted risk:** a stolen admin password grants that admin's full permissions, including KYC document access and order state changes, directly through PostgREST as well as the UI. Mitigations in the meantime: least-privilege per-area permissions, owner-only admin management, audit log on every sensitive action, and KYC files deleted after review so there is little to exfiltrate. Revisit before launch.

## 2026-09-23 — ID documents deleted after review
- **Context:** spec §12.3; identity documents are the most damaging data we would hold.
- **Decision:** the file is deleted from storage after the admin approves **or** rejects. The row keeps only verdict, rejection reason, reviewing admin, timestamp, document type and the file's sha256; the audit log keeps the review and every document view. DB commit first, then storage delete; a scheduled purge retries any file whose delete failed.
- **Alternatives rejected:** fixed retention window, indefinite retention.
- **Consequences:** disputes cannot be re-examined from the original image; a rejected customer re-uploads. If the client later reports a legal retention duty, this becomes a retention window plus purge job.

## 2026-09-23 — OTP on registration and password reset only; policy configurable
- **Context:** spec §12.2; WhatsApp cost and login friction.
- **Decision:** OTP is required for registration, password reset and phone linking/changing (Google users). Not on normal login. The policy is a typed setting (`otp_login_policy`, default `never`) read by the auth code, so changing it is configuration, not a rewrite. If login OTP is ever required, it is implemented as a proper second factor, not a half-authenticated session.
- **Alternatives rejected:** OTP on every login.
- **Consequences:** account security at login rests on password strength plus rate limiting.

## 2026-09-23 — Payment receipts require a transaction number with duplicate detection
- **Context:** spec §12.5; reusing a receipt is the cheapest fraud.
- **Decision:** a receipt upload requires the image, the destination bank account, and the transaction/reference number. The number is normalised and must be unique per bank account among non-rejected receipts (hard block, DB unique index). The image sha256 is stored; reuse on another order is flagged to the admin, not blocked. *(Superseded 2026-09-26: reuse is blocked — see Phase 5 receipts.)*
- **Alternatives rejected:** image only.
- **Consequences:** one extra field for the customer; admin verification in the bank app becomes a direct lookup.

## 2026-09-23 — Order references and invoice numbers
- **Context:** spec §12.7.
- **Decision:** order reference `FD-` + 7 random digits, unique with retry, generated in the database. Invoice numbers are gapless and sequential per year from a counter row updated inside the issuing transaction (`INV-YYYY-NNNNN`).
- **Alternatives rejected:** sequential order references (leak sales volume, guessable).
- **Consequences:** none beyond a retry loop on collision.

## 2026-09-23 — Hosting constraint: free tiers during development
- **Context:** the developer is not carrying hosting costs; paid plans are the client's decision before launch.
- **Decision:** development runs entirely on the Vercel Hobby and Supabase Free tiers. No design depends on paid features (no Supabase leaked-password protection, no PITR, no Vercel sub-daily cron, no paid add-ons). We assume **no automatic backups** and that **the Supabase project can pause on inactivity**.
- **Alternatives rejected:** designing around Pro features now.
- **Consequences:**
  - The app must recover cleanly from a cold or paused database: DB calls have timeouts, public pages render a localized "temporarily unavailable" state instead of crashing, and nothing caches a failed response as success.
  - Recurring jobs (WhatsApp retry, purge) must work with at most daily Vercel Cron, or be triggered opportunistically / by Supabase `pg_cron`.
  - The Arabic handover guide includes a manual backup procedure (`supabase db dump` for schema + data, and a storage export).
  - Before launch the client is told plainly that Vercel Hobby is non-commercial and Supabase Free has no backups; upgrading is their call.

## 2026-09-23 — Client-side blockers behind interfaces
- **Context:** Meta verification/templates, payment card, WhatsApp number, domain, logo and content are client-owned and may arrive late.
- **Decision:** every one is behind an interface or config with a local default so no phase waits: WhatsApp → service interface + dev driver; domain → `NEXT_PUBLIC_SITE_URL` env; logo → text wordmark component swapped for an asset later; content/policies → translation files and MDX placeholders clearly marked as placeholder in the UI source (never presented as real client content in production).
- **Consequences:** launch checklist must verify every placeholder has been replaced.

## 2026-09-23 — Blocking acceptance tests for Phase 2
- **Context:** the anon key is public, so PostgREST is reachable directly by any user.
- **Decision:** Phase 2 is not done until these tests exist, have been shown failing before the fix and passing after:
  1. Public `auth.signUp` is closed: no account can be created without a verified OTP.
  2. A customer cannot modify `kyc_status`, any price column, or any order state through a direct PostgREST call with the anon key + their JWT.
  3. A customer cannot read another customer's orders, receipts, invoices or KYC records through a direct PostgREST call.
- **Consequences:** Phase 2 needs a runnable local Supabase stack (or a dedicated test project) for these tests.

## 2026-09-23 — Phase 1 framework choices
- **Context:** Phase 1 scaffolding.
- **Decision:** Next.js 16 (App Router, Turbopack), React 19, Tailwind CSS v4 with CSS-variable tokens, shadcn/ui (new-york style), next-intl with `localePrefix: 'always'` and Arabic as default locale, `next-themes` for dark mode (class strategy, system default), `@supabase/ssr` for cookie-based sessions, Zod-validated environment in `src/lib/env.ts`. Request interception lives in `src/proxy.ts` (Next 16 name for middleware).
- **Alternatives rejected:** hand-rolled theme switching (flash of wrong theme without `next-themes`' pre-hydration script).
- **Consequences:** `next-themes` is the one dependency beyond the declared stack; reason recorded here.

## 2026-09-23 — Phase 1 implementation notes
- **Locale detection off.** `/` always redirects to `/ar`; `Accept-Language` is ignored. Many Sudanese phones run an English UI, so detection would send most visitors to `/en`, contradicting Arabic-first. Users switch explicitly.
- **Minimal client i18n payload.** `NextIntlClientProvider` receives only the `Errors` namespace (needed by the client error boundary). Other client components get translated strings as props from Server Components.
- **Font.** IBM Plex Sans Arabic (covers Arabic + Latin), weights 400/700 only, self-hosted at build time by `next/font` (≈95 KB for 4 files). Users never contact Google.
- **Session refresh in the proxy only when an auth cookie exists**, with a 4 s timeout and failures swallowed: anonymous traffic never touches Supabase, and a paused free-tier project cannot block public pages. Server-side Supabase clients use a 10 s fetch timeout for the same reason.
- **Service-role import guard.** ESLint `no-restricted-imports` blocks `@/lib/supabase/admin` everywhere except an explicit allowlist in `eslint.config.mjs`.
- **RTL guard.** `npm run lint` fails on physical-direction Tailwind utilities (`ml-*`, `left-*`, `text-left`, `border-r`, …) and on translation key drift between `messages/ar.json` and `messages/en.json`. Custom scripts, no dependencies.
- **shadcn/ui set up by hand.** The session's network policy blocks `ui.shadcn.com`, so `components.json`, `cn()`, theme tokens and `Button` were written following shadcn's Tailwind v4 layout. The CLI (`npx shadcn add …`) works normally on a machine with open network access.
- **Brand contrast.** White on `#005CFF` ≈ 5.3:1 (AA). White on `#FF7A00` ≈ 2.6:1 fails AA, so the orange `highlight` token uses dark text (≈ 7.6:1).
- **Dependencies added beyond the declared stack, with reasons:** `next-themes` (flash-free theme switching), `server-only` (compile-time guard for secret modules), `class-variance-authority`/`clsx`/`tailwind-merge`/`radix-ui`/`lucide-react`/`tw-animate-css` (shadcn/ui's own requirements), `prettier` + `prettier-plugin-tailwindcss` (consistent formatting and class order), `supabase` CLI as a dev dependency (migrations and local stack from Phase 2). React Hook Form is deferred to Phase 3, when the first form exists.
- **Deferred:** nonce-based Content-Security-Policy (Phase 10, once Turnstile/third-party scripts are known). Baseline security headers are set now.

## 2026-09-23 — Content-Security-Policy: accepted technical debt (target: Phase 9)
- **Context:** Phase 1 ships baseline security headers (`nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`) but no CSP. Without CSP, any XSS bug has no second line of defence.
- **Decision:** accepted as technical debt, **target Phase 9**, verified in the Phase 10 security review. Plan: nonce-based `script-src` set in `src/proxy.ts`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, `connect-src` limited to the Supabase URL (+ Turnstile if adopted), `img-src` limited to self + Supabase storage. Ship as `Content-Security-Policy-Report-Only` first, then enforce.
- **Why not now:** third-party origins (Turnstile, Supabase storage URLs, possibly Meta) are not final until Phases 3–7; a nonce CSP also forces dynamic rendering of pages that are currently static, which needs measuring.
- **Risk while open:** XSS impact is not reduced by the browser. Mitigations meanwhile: React's escaping, no `dangerouslySetInnerHTML`, no user HTML/markdown rendering, private files never rendered through `next/image`.

## 2026-09-23 — Phase 2: the database derives every money field
- **Context:** CLAUDE.md rule 2 (server is the authority). A Server Action is still application code; one bug there would be enough to mis-price.
- **Decision:** `BEFORE INSERT` triggers on `orders` and `invoices` compute every money/snapshot field from the database (variant price, current `usd_sdg_rate`, `kyc_threshold_usd`, product names, reference, status). Values sent by any caller, including service_role, are overwritten. `BEFORE UPDATE` triggers make the snapshot immutable, enforce the status machine (`order_status_transitions`, `→ processing` requires an accepted receipt) and make invoices immutable except `issued → void` with a reason. Orders, invoices and receipts cannot be deleted. KYC threshold, blocked customers, unverified phones and inactive variants are also enforced in the order trigger.
- **SDG rounding:** `total_sdg = ceil(total_usd × rate)`, whole pounds, rounded up (owner never under-collects; whole amounts are easy to match on receipts). Also a CHECK constraint.
- **Alternatives rejected:** pricing only inside a `create_order` RPC (any other insert path would bypass it).
- **Consequences:** Phase 5's `create_order` becomes thin (auth, field validation, idempotency). Changing money rules means a migration, not an app deploy.

## 2026-09-23 — Phase 2: grants model
- **Decision:** start from zero privileges (Supabase grants ALL on public tables to anon/authenticated by default), then grant per table. Customers have **no INSERT/UPDATE/DELETE** on money/state tables; customer-writable columns are column grants (`profiles.full_name, locale`; `comments.product_id, body`). Admin-only columns (kyc_status, is_blocked, statuses) change only through SECURITY DEFINER functions that check `has_permission()`. Global `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`, because per-schema default privileges cannot remove Postgres' global PUBLIC execute (found by a planted test: a new function was callable via `/rpc`). `private` schema: not exposed, no grants, RLS on.
- **Split settings:** `app_settings` (public: rate, threshold, contacts, banner) vs `security_settings` (OTP policy, country allowlist, OTP budget — settings admins only), because column grants cannot differ between customers and admins (same `authenticated` role).
- **Regression guard:** `supabase/tests/04_security_coverage.test.sql` fails if any table lacks RLS, any public function is callable by anon, `authenticated` can call anything beyond the intended RPCs, or a private table/function is exposed.

## 2026-09-23 — Phase 2: public sign-up closed in two layers
- **Layer 1 (config):** `[auth] enable_signup = false` in `supabase/config.toml` (`GOTRUE_DISABLE_SIGNUP=true`). Admin `createUser` still works. **Must be applied to the hosted project** (`supabase config push`, or Dashboard → Authentication → Sign In / Providers → "Allow new users to sign up" OFF) — added to the launch checklist.
- **Layer 2 (database):** deferred constraint trigger `guard_auth_user_insert` on `auth.users`: at COMMIT, every new user must carry `app_metadata.signup_verified = 'otp'`, which only the service role can set. Deferred because GoTrue's admin `createUser` writes `app_metadata` in a second statement after the INSERT (a plain BEFORE INSERT trigger rejected the legitimate server path — caught by the control test).
- **Proven independently:** with only layer 2 active (config open) all public sign-up paths fail; with only layer 1 (guard dropped) all public paths fail but an unmarked server-side `createUser` succeeds.
- **Consequence — open question for Phase 3:** Google OAuth cannot create new accounts under this rule (no OTP marker). Google can still be *linked* to an existing phone-verified account. If new sign-ups via Google are wanted, Phase 3 must decide how (e.g. Google creates the account only through a server flow that first verifies a phone OTP).
- `[auth.email] enable_signup` stays `true`: in this CLI version it maps to `GOTRUE_EXTERNAL_EMAIL_ENABLED` (the whole provider, logins included), not to sign-ups.

## 2026-09-23 — Phase 2: audit log
- **Decision:** `public.audit_logs` written only by a generic SECURITY DEFINER row trigger (`private.audit_row`) on orders, receipts, KYC, profiles, catalog, settings, bank accounts, admins, permissions, invoices, comments. UPDATEs log only changed columns; sensitive/noisy columns excluded per table (`fulfillment_data`, `fulfillment_fields`, invoice `snapshot`, `search_text`). No INSERT/UPDATE/DELETE/TRUNCATE grant for anon, authenticated **or service_role**; BEFORE UPDATE/DELETE and BEFORE TRUNCATE triggers raise for every role that fires triggers. Owner-only read.
- **Known limit:** a Postgres superuser can disable triggers. On Supabase that is the platform's `supabase_admin`, not an application role. Tamper-evidence (hash chain) remains optional.
- **Actor attribution:** `auth.uid()` from the caller's JWT, which is why admin mutations must run with the admin's session, not service_role (audit test proves the orders admin is recorded as actor).

## 2026-09-23 — Phase 2: migrations are forward-only
- **Context:** Definition of done says "migrations applied and reversible in a fresh environment".
- **Decision:** migrations are forward-only (Supabase CLI has no down migrations). "Reversible" is met as *reproducible*: `supabase db reset` rebuilds the whole schema from zero, and every test run starts from that. A bad migration in production is fixed by a new forward migration, never by editing history.
- **Consequence:** migration files are immutable once pushed to a shared environment.

## 2026-09-23 — Phase 2: local test stack
- **Decision:** tests run against the real local Supabase stack (Postgres, GoTrue, PostgREST, Storage, Kong) in Docker: pgTAP (`supabase test db`) for database invariants, Vitest over HTTP with the anon key for the acceptance tests. `npm run test:integration` resets the database first (the owner row is unique and undeletable, so runs must start clean).
- In sandboxed environments where `public.ecr.aws` is blocked, start the stack with `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`.
- `vitest` added as a dev dependency; `@types/node` aligned to Node 22 (Vitest 5 requirement, matches the runtime).

## 2026-09-23 — Correction to the Phase 1 report
- Phase 1 reported "no console errors except the intended 404". That was wrong: the second 404 was attributed to `/favicon.ico` without proof. Instrumented in Phase 2, it is a background RSC segment prefetch for `/en` (see roadmap Phase 9 known issue). Navigation works; the prefetch fails. Logged, not fixed in Phase 2 (out of scope, framework-level).

## 2026-09-24 — Phase 3: Google sign-in creates incomplete accounts
- **Context:** Hassan's rule: Google may create new accounts, but an account is only completed after a phone number is verified by OTP; an abandoned Google sign-up must never become usable.
- **Decision:** a Google sign-in creates an auth user with no phone. "Complete" = `profiles.phone_verified_at IS NOT NULL`. Enforced at three levels:
  1. App: every authenticated route (`/account/**`, `/admin/**`) goes through `requireCompleteUser()`; incomplete sessions are redirected to `/[locale]/complete-account`, the only page they can open. Admin checks run after the completeness check.
  2. Database: orders, KYC submission and comments already require a verified phone (order trigger, `submit_kyc`, comments RLS), so a direct PostgREST call with an incomplete session achieves nothing.
  3. Cleanup: `private.purge_incomplete_accounts()` deletes incomplete accounts older than 24 h, scheduled nightly with `pg_cron` (free tier).
- Completing = OTP to a phone that is not already registered → `auth.admin.updateUserById(phone, phone_confirm, app_metadata.signup_verified='otp')`; the `auth.users` trigger fills the profile. If the phone belongs to another account, the user is told to sign in with that phone and link Google from the account page (`linkIdentity`, manual linking enabled).
- **Not verifiable locally:** there are no Google credentials in development. The Google path is covered by SIMULATED accounts (an `auth.users` row exactly as GoTrue creates it, `provider = google`) and by testing the hook with Google/non-Google payloads. The real OAuth round-trip must be tested once credentials exist (launch checklist).

## 2026-09-24 — Phase 3: sign-up layers revised for Google
- **Context:** Phase 2 closed sign-up with the global `enable_signup = false`. That also blocks Google OAuth sign-ups, which are now required.
- **Decision:** `[auth] enable_signup = true`, and every other creation path is closed individually:
  1. `before_user_created` Auth hook (`private.auth_hook_before_user_created`) rejects every creation whose `app_metadata.provider` is not `google`. Verified: GoTrue does not call this hook for the admin API, which is how the server creates accounts after OTP.
  2. DB guard `guard_auth_user_insert` (deferred constraint trigger) now accepts the OTP marker **or** `provider = google`.
  3. Email provider off (customers never use email), anonymous sign-in off.
  4. **Send SMS hook refuses every message.** Found while probing: with the phone provider on, `signInWithOtp({phone})` made GoTrue generate its own OTP and hand the plaintext code to the SMS hook — a second login path outside our limits and budget. The refusing hook disables GoTrue's phone OTP login, phone-change codes and SMS confirmations. Our OTPs go only through the WhatsApp service.
- **Local CLI quirk:** the CLI turns the phone provider (needed for phone + password login) on only when an SMS provider is "enabled", so `config.toml` has Twilio placeholders. Twilio is never called (the hook takes precedence). Hosted: enable the Phone provider with the Send SMS hook; no Twilio account.
- Acceptance test 1 re-run with the new layout (all public paths refused, GoTrue phone OTP refused, server path works).

## 2026-09-24 — Phase 3: OTP design
- Codes: 6 digits from `crypto.randomInt`, stored only as `HMAC-SHA256(OTP_HMAC_PEPPER, phone|purpose|code)`. Plaintext exists only in memory and in the WhatsApp message. `message_logs` rows for OTPs cannot carry a payload (DB constraint). Proven by searching every row of `otp_codes`, `message_logs`, `audit_logs`, `rate_limit_events` for the code (0 hits) and by capturing all console output during issue + verify.
- Issue/verify are atomic database functions (`otp_issue`, `otp_verify`, service role only). Limits: 5-minute expiry; 5 attempts per code, counted before comparison, then the code is dead even for the right answer; only the newest code per (phone, purpose) is valid; 60 s cooldown per phone; 5/hour and 10/day per phone; 10 codes/hour per IP; 30 failed verifications/hour per IP; global daily budget (`security_settings.otp_daily_budget`, default 300) that stops all sending. Worst case per phone: 25 guesses/hour out of 1,000,000.
- Issuance is serialised with a transaction advisory lock (no race past the limits; fine at this volume).
- Registration verifies the code and creates the account in one Server Action: there is never a half-registered phone account.
- Login: phone + password; failed-login throttles 10/phone and 30/IP per 15 min on top of GoTrue's per-IP limits. `otp_login_policy = 'always'` fails closed until implemented as a real second factor.
- Password reset answers identically for registered and unregistered numbers, then revokes all sessions of the user.
- Accepted residual risk: registration says "this number already has an account" (needed UX), so account existence can be probed at 30 lookups/hour per IP.

## 2026-09-24 — Phase 3: WhatsApp dev driver guard
- The dev driver prints OTP codes, so it is allowed only when `NODE_ENV` is `development`/`test` **and** the process is not a Vercel preview/production deployment. Checked at server boot (`src/instrumentation.ts`), when the driver is built, and again on every send. A missing/unknown `WHATSAPP_DRIVER` also refuses to boot.
- Proven on a real production build: `next start` with the dev driver → every request 500 with the refusal message; `next dev` with `VERCEL_ENV=preview` → exits; `meta` → serves 200. Vercel preview deployments therefore cannot use the dev driver either (their logs would contain codes); previews need the Meta driver (Phase 7).
- The Meta driver exists as a stub that throws "not implemented (Phase 7)" — nothing pretends to deliver.

## 2026-09-24 — Phase 3: KYC pipeline
- Browser shrinks the photo (≤2000 px JPEG) before upload for weak connections; the server trusts none of it: size ≤ 5 MB, extension and declared MIME allowlists, real format from the bytes (sharp), decompression-bomb limit (40 MP), minimum 300 px, then **decode + re-encode** to JPEG without metadata (EXIF/GPS/XMP/ICC and any appended payload removed).
- Upload with the service role (only `src/server/files/storage.ts`, inside the existing allowlist — no allowlist change), then `submit_kyc()` with the customer's own session: path must be in their folder, the object must exist, phone verified, one pending, 3/day.
- Review with the reviewer's own session: `kyc_open_document()` writes an audit row for every view, then a 60 s signed URL is created; plain `<img>` (never `next/image`). `review_kyc()` refuses reviewing one's own submission and requires a reason to reject. The file is deleted through the Storage API right after the verdict (new policy: reviewers may delete only non-pending documents); `kyc_mark_file_deleted()` refuses while the object still exists.
- Who can read a KYC file: only admins with the `kyc` permission (the Owner has all permissions). The customer who uploaded it cannot read it back (Phase 2 design, kept). If the customer should be able to see their own pending document, that is one storage policy — not done without approval.
- Known gap: if the post-review delete fails, the file stays until retried (row keeps `storage_path`, visible as "pending deletion"); an automatic retry job is Phase 7 (cron) work.

## 2026-09-24 — Phase 3: bank branch names
- Arabic branch names in `bank_accounts` stay as placeholders; client content arrives at the end of the project (Hassan, 2026-09-24).

## 2026-09-24 — Phase 3 dependencies
- `sharp` (image validation + re-encoding; already used by Next, now explicit), `react-hook-form` + `@hookform/resolvers` (declared stack), `@playwright/test` (dev: end-to-end tests required by the verification rule; browsers not downloaded in CI sandboxes, `PLAYWRIGHT_CHROMIUM_EXECUTABLE` can point to a local Chromium).

## 2026-09-24 — KYC file access stays reviewer-only (confirmed)
- **Decision (Hassan):** only admins with the `kyc` permission (and the Owner) can read identity documents. The customer who uploaded a document cannot read it back.
- **Why:** the customer already has their own copy; an extra read path on identity documents is attack surface with no real benefit.
- **Alternatives rejected:** a storage policy letting customers read their own pending document.
- **Consequence:** the customer UI shows only the KYC status and rejection reason, never the image. Tested in `tests/integration/kyc.test.ts` ("the customer who uploaded it: cannot download or sign the file").

## 2026-09-25 — Phase 4: fulfillment fields
- **Types:** `text`, `digits`, `phone`, `email`, `select`. No admin-supplied regex: a pattern typed in the dashboard would run against user input on the server (ReDoS). `digits` covers player IDs with leading zeros; `select` covers servers/regions. Optional `sensitive` flag reserved for Phase 5 masking/purge.
- **Definitions** (`product_variants.required_fields`) are validated twice with the same rules: Zod (`src/lib/fulfillment.ts`, admin forms in Phase 6) and a CHECK constraint (`private.valid_field_definitions`), so a malformed definition cannot be saved by any path.
- **Submitted data** is normalised and validated in TypeScript (trim, Arabic-Indic → ASCII digits, Sudanese phone → E.164, empty optionals dropped) and re-validated strictly in the **order trigger** (`private.fulfillment_errors`): missing, unknown key, non-string type, length, format, select option. The TS and SQL validators are tested for identical verdicts on the same inputs.
- **Product page (Phase 4 scope):** the details form posts to the `checkOrderDetails` Server Action, which re-reads the variant as `anon` (a forged hidden-variant id is "unavailable") and validates server-side. On success it says the details are valid and that placing the order comes next; Phase 5 turns that step into order creation. No fake order is created.

## 2026-09-25 — Phase 4: public catalog rendering
- Public pages read through a cookie-less **anon** client (`src/lib/supabase/public.ts`): RLS decides visibility, and admins browsing the storefront see exactly what customers see. A product is shown only if it, its category and at least one variant are visible; otherwise 404.
- `search_products()` and `price_sdg()` are `SECURITY INVOKER` and executable by anon — the only anon-callable functions (coverage test updated). All SDG prices are computed in SQL with the order trigger's formula (`ceil(usd × rate)`); a test proves the displayed price equals the charged amount.
- **Rendering:** home, category and product pages are static with `revalidate = 300` (ISR; category/product built on first visit via `generateStaticParams() → []`). Search is dynamic and `noindex`. Build output and `x-nextjs-cache: MISS → HIT` verified. Accepted: a displayed price can lag a rate change by up to 5 minutes; the order snapshot uses the live rate (Phase 5 shows the exact amount before confirming). Phase 6 admin edits will call `revalidatePath`.
- **Cold database:** cached pages keep serving while the database is down; uncached pages show the "temporarily unavailable" boundary, and **Retry now recovers** (switched from `reset()` to Next 16.3's `retry()`, which re-fetches; `reset()` never recovered from a server error — Phase 1 bug found by this test). During `next build`, catalog sections degrade to empty if the database is unreachable (CI / paused project) and fill in on the first revalidation.
- **SEO:** per-page title/description with language fallback, canonical + hreflang (ar, en, x-default), Open Graph, JSON-LD `Product` (AggregateOffer in SDG) + `BreadcrumbList` (escaped against `</script>`), `sitemap.xml` built from anon-visible rows only, `robots.txt` excluding account/admin/auth/search.
- **Language fallback:** paired `_ar/_en` columns; the requested language wins, otherwise the other language is shown with its own `lang`/`dir`, so Arabic inside an English page (and vice versa) shapes and aligns correctly.
- **Images:** a brand placeholder tile for now; real product images (upload + `next/image` with the storage host) arrive with the Phase 6 admin upload.

## 2026-09-25 — Phase 4: client JavaScript budget on public pages
- Measured with `next build` + `next start` on `/ar/p/pubg-uc`: **210.8 KB → 185.9 KB gzip** (home 208.7 → 183.9 KB). What remains is ~160 KB React/Next runtime (fixed cost of the App Router), `next-themes`, router/link helpers and the 2 KB order-details form.
- Removed from every public page: next-intl's client runtime (12 KB; server components now use `@/components/link`, a server-side locale-prefixing `next/link`; client components that need next-intl keep it under their own `ClientMessages` provider), `lucide-react` (its icons are `"use client"` in v1.47 — verified in `dist/esm/Icon.mjs` — so even a server-rendered icon ships JS; replaced by inline SVG), and `tailwind-merge`/Radix `Slot` (public client components use plain class strings from `src/components/ui/styles.ts` and `button-variants.ts`).
- Variant choice, search, filters and pagination work without client JS (links and GET forms).
- Auth pages: Google button now loads supabase-js on click (login page 379 → 312 KB). The remaining weight is Zod + React Hook Form in the client forms — logged for Phase 9 (move shared schemas to `zod/mini` or validate on the server only).

## 2026-09-25 — Phase 4: grants for generated columns and CHECK functions
- Found by the fixtures: `service_role` could not insert a product (`permission denied for function normalize_ar`) because functions in generated columns and CHECK constraints are evaluated with the writing role's privileges, and `service_role` had no USAGE on `private`. Migration `20260925100100_catalog_grants.sql` grants USAGE + EXECUTE on the two pure functions only (`normalize_ar`, `valid_field_definitions`). The seed never hit this because it runs as `postgres`.

## 2026-09-25 — Login page weight: accepted debt (target Phase 9)
- **Measured (Phase 4, `next build` + `next start`, gzip):** `/ar/login` ships **312 KB** of JavaScript (379 KB before the Google button was made lazy); public catalog pages ship 184–186 KB.
- **Cause:** the auth forms validate on the client with the shared Zod schemas + React Hook Form + `@hookform/resolvers`. One chunk holding Zod and RHF is ≈102 KB gzip. Zod v4's classic API is not tree-shakeable enough for this use.
- **Why it matters (Hassan):** login is the first page a customer hits after browsing; 312 KB is too heavy on weak connections.
- **Target Phase 9:** move the shared schemas to `zod/mini` (tree-shakeable) or keep full validation server-side only and use native HTML constraints in the browser; re-measure and record the new number here.

## 2026-09-26 — Phase 5: order creation and the price the customer agreed to
- **Only path:** `public.create_order(variant, quantity, fulfillment, idempotency_key, expected_total_sdg)`, SECURITY DEFINER, run with the customer's JWT (so `auth.uid()` is the buyer and the audit actor). Customers have no INSERT grant on `orders`; the BEFORE INSERT trigger still derives every money field for any path (service role included).
- **Price consent, not price input:** the page sends the total it showed. The function computes the live total (`ceil(price_usd × qty × rate)`) and, if it differs, creates nothing and returns `price_changed` with the current total; the form shows it and the customer must press again. After the insert, the trigger's snapshot total is compared with the agreed one, so a rate change landing between the check and the insert also rolls back (demonstrated with a planted trigger). Result: an order is never created at a total the customer did not see, and never at a total the database did not compute. Rejected: silently charging the new price (customer surprise), trusting the page's price (tampering).
- **Totals per quantity come from SQL** (`price_sdg_totals()` computed field, anon-callable, SECURITY INVOKER): per-unit price × quantity differs from the charged total by the rounding, and JS floats get it wrong (1.10 × 3 × 2600 = 8580.000000000001 → 8581). The formula exists in one place.
- **Idempotency:** a client-generated UUID per attempt; `(user_id, idempotency_key)` is unique, so double clicks and retries return the same order (concurrent duplicate → unique violation → existing order returned).
- **Abuse limit:** 10 orders per customer per hour (`rate_limited`). Orders create staff work and, from Phase 7, WhatsApp messages.
- **KYC:** unchanged rule (trigger, USD total ≥ `app_settings.kyc_threshold_usd`, read at insert time); the RPC maps it to `kyc_required` and the form links to verification.
- **Form submission:** the product form submits via `onSubmit` + `startTransition`, not a form `action`: React 19 resets uncontrolled fields after a form action, which wiped the customer's input on a `price_changed` answer (found by the E2E test; the browser then blocked the second submit on `required`).

## 2026-09-26 — Phase 5: receipts, duplicates and review
- **Changes the Phase 1 decision on receipt images:** a reused receipt image is now **blocked**, not only flagged — unique partial index on `file_sha256` where status ≠ rejected (same shape as the transaction-number index). Reason: the flag had no consumer until Phase 6, and a legitimate customer never needs the same receipt for two orders.
- **Where the hash comes from:** the server re-encodes the upload (sharp, EXIF stripped), uploads it with the service role and writes `sha256` into the object's `user_metadata`. `submit_receipt()` reads the hash from `storage.objects`, never from a parameter, and customers cannot write to the bucket — so a caller cannot dodge detection by sending a made-up hash. A file without that metadata is refused.
- **Limits of image matching:** it catches the *same file* re-uploaded (re-encoding is deterministic for identical input). Screenshots under 1.5 MB go up unchanged; larger photos are shrunk in the browser first, and different browsers may encode differently. A cropped or re-shot image is a different file. The transaction number stays the primary guarantee.
- **Transaction number:** trimmed; normalised (spaces/dashes removed, upper case) to 4–40 letters/digits; unique per bank account among non-rejected receipts. The friendly check gives a clear error, the unique index is the real guarantee (a concurrent-submission test shows exactly one winner). After a rejection the same number can be resubmitted (typo corrections).
- **Receipt rules:** own order only (another customer's order and a missing one give the same `ORDER_NOT_FOUND`), order status `new`, one pending receipt at a time, max 5 per order, active bank account, path `{user}/{order}/{uuid}.jpg`. Rejected uploads are removed from the bucket again.
- **Review:** `review_receipt(id, accept, reason)` needs the `orders` permission; a reason is required to reject; staff cannot review a receipt on their own order. Accepting moves the order to `processing` through the normal transition trigger (which requires an accepted receipt). The admin screens that call it are Phase 6; in Phase 5 it is exercised through the API by tests.
- **Audit:** order creation (`orders.insert`, actor = customer) and receipt submission (`payment_receipts.insert`) are now audited in addition to updates. Fulfillment data stays out of the log.
- **Sensitive fields:** fields defined with `"sensitive": true` are removed from `fulfillment_data` when the order reaches a terminal status (completed/cancelled), inside the orders BEFORE UPDATE trigger; the order page shows "removed after the order was closed".
- **Customer pages:** `/account/orders` and `/account/orders/{reference}` read with the customer's session and also filter on `user_id` (RLS alone would show staff every order). Another customer's reference is the same 404 as a non-existent one.

## 2026-09-27 — Phase 6: abuse limits are settings (approved by Hassan)
- `security_settings` gains `order_rate_limit_per_hour` (10), `receipts_per_order_limit` (5) and `comment_rate_limit_per_hour` (5). `create_order()`, `submit_receipt()` and the comments trigger read them at the moment of the request. Edited in *Settings → Limits* by `settings` staff; every change is in the audit log.
- Placed in `security_settings`, not the public `app_settings`, so the thresholds are not readable by visitors (tested).

## 2026-09-27 — Phase 6: how the dashboard enforces permissions
- **Three layers, each sufficient on its own for data access:** (1) every admin page calls `requireAdmin(locale, permission)` / `requireOwner(locale)` and answers 404 otherwise; (2) every admin Server Action's first statement is `actionAdmin(permission)` / `actionOwner()`; (3) the action writes with the admin's own session, so RLS and the definer functions check the permission again. A static test fails the build if a page or action misses its guard or if admin code imports the service-role client.
- Demonstrated by: a 21-operation × 9-role matrix against the database; a 404 matrix for 14 admin URLs × 9 roles; replaying the exact Server Action requests captured from the owner's browser with the cookies of an anonymous visitor, a customer and lower staff (all `not_allowed`, no state change); a stale tab whose permission was revoked. With the action's guard deliberately removed, the replayed request is still refused by the database.
- `admins` / audit log remain owner-only. The database stamps `admins.created_by` and `admin_permissions.granted_by` (never taken from the client) and refuses to make an unverified or blocked account an admin.
- **Blocking customers** goes through `set_customer_blocked()` (`customers` permission): never oneself, never the owner, and only the owner may block another admin. A blocked customer can still sign in and see their orders, but cannot order or comment.
- **Comment moderators** see authors' names through `admin_comments()` (definer, `comments` permission) instead of being granted read access to `profiles` (phones).
- **GraphQL** (`pg_graphql`) is dropped by migration: the app does not use it and hosted projects enable it by default. The notes test re-enables it temporarily to show RLS still holds there. To verify on the hosted project in Phase 10.

## 2026-09-27 — Phase 6: customer comments (spec §2) built with moderation
- Moderation needs comments to moderate, and none could be written yet, so the product page gained a comments section: verified, unblocked customers post (post-moderation: visible at once, staff hide or delete). The database stamps the author, applies the hourly limit, and records the moderator (`hidden_by`) itself.
- Public pages read comments through `product_comments()` (definer): only visible comments of visible products, author's **first name only**, no ids or phones. Plain text rendered escaped; no links are turned into anchors.

## 2026-09-27 — Phase 6: public images
- Product, banner and logo images go through the same inspect step as KYC (extension + MIME + real format must agree, pixel and size limits), then are re-encoded server-side to WebP at fixed sizes: product 1000 px + 400 px thumbnail, banner 1600 px, logo 512 px (transparency kept). Minimum dimensions and an aspect-ratio range per kind; SVG and GIF refused. Nothing from the original file (EXIF, appended data) survives.
- Served straight from the public bucket with a plain `<img>` at the right size. **Replaces the Phase 9 plan of `next/image`**: the images are already optimized, and Vercel's image optimizer has a monthly quota on free plans.
- Written with the admin's session; storage policy `can_write_public_asset()` confines `products` staff to `products/` and `categories/`, `settings` staff to `site/`.
- Catalog, price, banner, FAQ and contact edits call `revalidatePath("/", "layout")`: every static page is refreshed at once. Edits are rare; tracking which pages show what is not worth it.

## 2026-09-27 — Phase 6: bug found in Phase 3 forms — values in the URL before hydration
- **Found:** every form that submits through JavaScript (`onSubmit`) was a plain `<form>` in the server HTML. Clicked before React hydrated (slow connection, script still loading), the browser submitted it natively as **GET**, putting its values in the URL. Demonstrated with JavaScript disabled on the login form: the URL became `/ar/login?phone=…&password=…` and the dev server's access log recorded the password (CLAUDE.md rule 9).
- **Fix:** all such forms (login, register, reset, complete account, profile, KYC, receipt, order, comment, every admin form) are `method="post"` and keep their submit button disabled until hydration (`useHydrated()`); pressing Enter does nothing. A permanent E2E test loads 10 pages with JavaScript off and checks every form; planting the old login form makes it fail. Server-action forms that work without JavaScript (sign out) are real POSTs and stay enabled. The product order form is disabled as a whole until hydration: its option and quantity are controlled inputs that hydration would reset (found by the Phase 5 E2E test on a cold dev server: quantity 3 silently became 1).
- **Also:** the product order form now submits through `onSubmit` like the rest (Phase 5), and Zod's `z.uuid()` (strict RFC variant bits) is replaced by `z.guid()` for ids the database checks anyway: the seed ids failed it.

## 2026-09-27 — Owner account bootstrap (for Phase 10)
- There is no UI to create the first owner, by design. After the client registers normally (phone + OTP), the developer runs one statement in the Supabase SQL editor: `insert into public.admins (user_id, is_owner) values ('<their user id>', true);` The single-owner index and the owner protections apply from then on. Added to the Phase 10 checklist.

## 2026-09-28 — Scope note: comments moved from Phase 9 into Phase 6 (approved by Hassan)
- Customer comments on product pages were built in Phase 6 together with their moderation screen (decisions.md 2026-09-27). The client contract prices comments as a separate item; for invoicing and acceptance, that item is delivered in Phase 6, not Phase 9.

## 2026-09-28 — Upload limits for public images (Hassan: resize before upload, enforce limits)
- Staff resize images before upload (docs/handover.md). Enforced on the upload itself: 2 MB per file (checked in the browser before uploading and again on the server), a maximum longest side per kind (product 4000 px, banner 6000 px, logo 2000 px) in addition to the minimums, aspect ranges and the 40-megapixel decode guard.

## 2026-09-28 — Phase 7: WhatsApp notifications are an outbox that holds no content
- **Decision:** a business event (order status recorded, KYC decision) inserts a `queued` `message_logs` row **in the same transaction**, by trigger, holding only references (`order_id`, `status_history_id`, `kyc_submission_id`). The server renders the template parameters at send time from those records (`whatsapp_message_context()`). No network call happens inside a business transaction, so a Meta outage cannot fail or slow an order, a status change or a KYC review.
- **No content stored:** `payload`, `error_message` and `estimated_cost_usd` columns dropped. Errors are short codes (`meta:131026`, `http:503`, `network:timeout`, `config:not_configured`, `app:…`), enforced by a CHECK on the format, because Meta's error text can echo parameter values. The OTP row has no references and never the code. The webhook stores status, time, error code and pricing only; incoming customer texts and Meta's error details in the same payload are ignored. Rejected: storing the rendered text for staff convenience (it would copy notes and KYC reasons into a log table with wider read access).
- **Sending:** right after the request that queued something (`after()`, the customer's response is already sent), and every minute by `pg_cron → pg_net → /api/whatsapp/dispatch` (bearer secret, URL and secret in Supabase Vault) while something is due. Rejected: Vercel Cron (once a day on the free plan, too coarse for 1-minute retries); a separate worker (extra infrastructure).
- **Claims:** `whatsapp_claim()` uses `FOR UPDATE SKIP LOCKED` and a 120 s lease, so the after-response dispatch and the scheduler never send the same row twice. A run claims batches of three and stops claiming after 25 s, so it finishes within a 60 s serverless limit even when Meta times out on every call.
- **Bounded retries:** 4 attempts, waiting 1, 5, then 30 minutes. Only transient errors are retried (Meta 1/2/4/80007/130429/131000/131016/131048/131056/131057/133004, HTTP 5xx, network, timeouts); a permanent error fails at once. A final failure sets `needs_attention`; a send interrupted on its last attempt (lease expired) becomes `failed` / `app:interrupted` instead of staying queued. OTP is sent while the user waits, logged, **never retried** (a stale code is useless) and not flagged per message.
- **Admin alerts:** "Needs follow-up" list (contact on WhatsApp, retry once more, mark handled; both actions audited), a dashboard card, a nav badge, the order page's notification history, and a banner on every admin page for (a) a setup/account error (token, permission, template, billing) with nothing sent since, (b) an outage: the last three sends all failed within 15 minutes with nothing sent since, (c) messages due for over 10 minutes (scheduler not running). Visible to `orders` staff.
- **Webhook:** `X-Hub-Signature-256` checked over the raw bytes with the app secret (constant-time) before parsing; 1 MB cap; only our `phone_number_id`. Each `(wamid, status)` is inserted once into `private.message_events` (unique); a replay returns `duplicate` and changes nothing. Statuses only move forward (sent → delivered → read); `failed` flags the notification. On a database error the endpoint answers 500 so that Meta redelivers.
- **Cost:** category from the template at send → estimate from `whatsapp_rates`; Meta's `pricing` object in the first report that carries one fixes `billable`/category/cost for good. Rates start **empty** (no invented prices) and are entered by `settings` staff from Meta's rate card (audited). Spend per month by type and category is shown on the messages page to staff who also hold `settings` (and the owner).
- **Verify token:** Meta sends it in the handshake URL, so framework and platform request logs contain it (found by the log search in the E2E test). It only lets someone make the endpoint echo a string; still, the handover says to remove it after subscribing, and the endpoint then refuses handshakes.
- **Tested against a fake:** `tests/fakes/meta-graph.mjs` implements Meta's documented contract (endpoint shape, auth, template/parameter validation, error bodies, signed webhooks) and is scriptable (errors, timeouts, HTML 502, connection drops, offline). The app runs its **real** Meta driver against it in all E2E tests. What still needs the real API is listed in `docs/whatsapp-templates.md`.

## 2026-09-28 — Retry of KYC document deletions that failed after a review (resolved 2026-09-29 below)
- Roadmap Phase 7 lists a retry job for KYC files whose deletion failed right after the verdict (the row keeps `storage_path`; nothing retries it today and no screen shows it).
- Not built in Phase 7: a scheduled job that deletes objects from the private KYC bucket with the service role was stopped by the agent's permission guard (automated deletion in cloud storage), and needs Hassan's explicit go-ahead. Options: (a) the same minute tick deletes documents reviewed more than 5 minutes ago that still have a path, with a service-role twin of `kyc_mark_file_deleted()`; (b) a "documents awaiting deletion" list on the KYC admin page with a button that deletes with the reviewer's own session (existing policy and function, no new service-role code).

## 2026-09-29 — KYC documents awaiting deletion: reviewer button + 24 h banner (Hassan: option (b) plus an alert)
- The KYC page lists reviewed documents whose file is still stored (deletion after the verdict failed), with **Delete file**. It runs with the reviewer's own session: the storage policy allows `kyc` staff to delete only non-pending documents, and `kyc_mark_file_deleted()` refuses while the object still exists. Storage answers "ok" with an empty list when a policy silently blocks a delete; the action treats that as a failure. Audited.
- A red banner on every admin page, for `kyc` staff, while any such document has waited more than 24 hours; it clears once the file is deleted. No service-role deletion job (the Phase 7 question).

## 2026-09-29 — Phase 8: Arabic PDF export = the browser's print ("Save as PDF")
- **Options evaluated** against Vercel's free tier, no paid services, correct Arabic shaping and RTL:
  1. **Browser print** of the invoice page. Chromium's print pipeline (the same one as "Save as PDF") rendered a mixed Arabic/Latin sample correctly.
  2. **Server-side generation with an embedded font.** Tested PDFKit 0.20.2 with IBM Plex Sans Arabic: letters joined correctly (fontkit shapes Arabic), but it has no bidirectional algorithm, so spaces between Arabic and Latin runs disappeared ("INV-2026-00001رقم") and punctuation landed on the wrong side. Fixing that means pre-processing every string with a bidi library: fragile, and exactly the class of bug the spec forbids. The robust server-side variant is headless Chromium (`@sparticuz/chromium`, ≈70 MB unpacked): it fits a Vercel function but adds cold starts of seconds, memory, and a browser binary to keep in step with Puppeteer.
  3. **External service** (PDF APIs): free tiers are small or paid, and every invoice (name, phone, amounts) would go to a third party. Rejected.
- **Decision: 1.** The invoice page is a print-first A4 document; "Print / Save as PDF" opens the print dialog; the page title is the invoice number, so the saved file is named after it. Text stays text (selectable, searchable), fonts are the site's self-hosted IBM Plex Sans Arabic, zero server cost, no new dependency.
- **Cost of the choice:** the customer chooses "Save as PDF" in the dialog (hint shown on the page), and the output depends slightly on the browser. Real-phone checks (Android Chrome, iPhone Safari) are a Phase 10 item. If a server-made file is ever needed (e.g. sending the PDF on WhatsApp), render the same page with headless Chromium; nothing in the page changes.
- **Found while checking the rendered PDF:** wrapping values that Intl had already formatted in Arabic (dates, SDG amounts, the rate sentence) in a forced-LTR span tore them apart ("2026/09/ ،11:27 م25", ".2,860 ج.س"). Only Latin tokens (invoice/order numbers, phones, USD, transfer numbers) are forced LTR now; the others are isolated without a direction. An E2E test measures the on-screen positions (currency left of the amount, day right of the year, rate words in reading order); forcing LTR again makes it fail.

## 2026-09-29 — Phase 8: invoices issued on completion, gapless under concurrency
- **Issued automatically** when an order becomes `completed`, in the same transaction, so there is never a completed order without an invoice or an invoice for an order that did not complete. `issued_by` = the staff member who completed it (from the session, never from the caller).
- **Numbering** stays the Phase 1 counter row per Khartoum year. Demonstrated: 8 completions fired at once through the API get 8 contiguous numbers; 4 overlapping database sessions that hold their transaction for 1.5 s serialise on the counter row (≈ 6 s total), and the one that rolls back gives its number to the next. Rejected: a Postgres sequence (a rollback leaves a gap; shown by a planted sequence: 11 invoices, highest number 20) and max+1 (duplicate numbers under concurrency; planted: unique-key errors).
- **Snapshot** also holds the seller's business name (new `app_settings.business_name_ar/en`, editable in Settings; the product name is temporary and an invoice must keep the name it was issued under) and the accepted payment (bank, transfer number, date) instead of the list of bank accounts. Invoices render only from the snapshot: later price, rate, seller, name or phone changes show nothing different (E2E compares the page text and the database row before and after).
- **Corrections:** `invoices` staff void (reason required) and re-issue (next number, snapshot taken again: e.g. after fixing the customer's name). Customers only ever see their current issued invoice.
- **Access:** RLS (Phase 1) plus, on customer pages, an explicit owner filter (`search_invoices(p_mine)`, `getInvoice(ownerId)`), because invoices staff are customers too and RLS would show them everyone's invoices on "My invoices".
- **Search:** `search_invoices()` (SECURITY INVOKER): number, order reference, customer name (Arabic-normalised), phone in local `09…` or `+249` form, status, date range; newest first, 25 per page. No trigram index yet: invoice volume is small; add one if search slows.

## 2026-09-26 — Staging environment (before Phase 9)

**What:** a separate Supabase project `faris-digital-staging` (free tier) and a
separate Vercel project `faris-digital-staging`, holding demo data only. Demo
accounts sign in with phone + password; their passwords exist only in the reply
to Hassan, and `supabase/staging/demo-seed.sql` receives bcrypt hashes as psql
variables. The demo data is created through the same database functions the app
uses (review_receipt, change_order_status, review_kyc, void/reissue_invoice) as
the demo staff, so history, audit and the outbox are real, not inserted rows.
WhatsApp uses the real Meta driver with no credentials: sends fail visibly.

**Why:** Hassan needs a URL to review; production must never hold demo data
(CLAUDE.md rule 8), so staging is its own project rather than a branch of it.

**How it was applied:** SUPABASE_ACCESS_TOKEN / VERCEL_TOKEN were not set in the
agent environment, so the Supabase and Vercel connectors were used instead. Each
migration was sent as-is, wrapped in a block that checks its md5 against the
repository file before executing it; schema fingerprints (tables, columns,
grants, policies, functions, triggers, indexes, cron jobs, buckets) matched the
local stack exactly.

**Rejected:** a Supabase branch (paid feature); the dev WhatsApp driver on
staging (it prints OTP codes and is refused outside local development by design);
seeding demo users with the service key over the API (the key is not available to
the agent; SQL seeding through the real functions gives the same result).

**Open:** auth settings that exist only in the dashboard (phone provider, hooks,
sign-up toggle, password length) and `SUPABASE_SECRET_KEY` in Vercel are set by
Hassan (handover.md → Staging). The robots/noindex handling for staging belongs to
Phase 9.

## 2026-09-26 — Phase 9: auth forms validate with shared rules, not Zod + React Hook Form in the browser

**What:** the auth rules (phone, passwords, name, OTP code, locale) are plain
functions in `src/lib/validation/auth-rules.ts`. Server Actions still parse
with Zod: the schemas in `validation/auth.ts` are built *from* those rules, so
browser and server cannot disagree (unit test compares them input by input).
The browser forms (login, register, reset, complete account, profile) call
the rules through a 40-line `useRuleForm` hook. React Hook Form and
`@hookform/resolvers` were removed from the dependencies.

**Why:** login shipped 306.6 KB gzip, of which Zod was ≈ 101 KB and React Hook
Form ≈ 12 KB. After: 206.3 KB (catalog pages ship 180 KB; the difference is
next-intl's client runtime and the form components).

**Rejected:** `zod/mini` in the browser (two schema dialects to keep in sync,
still ~15–20 KB); server-only validation (no instant feedback on a slow
connection). CLAUDE.md lists "Zod + React Hook Form (schemas shared)"; Zod
remains the server authority and the rules stay shared, only the browser
libraries went, as the roadmap line approved in Phase 4 anticipated.

## 2026-09-26 — Phase 9: staff reach the dashboard from the account page

**What:** a card at the top of `/account`, shown only when the signed-in user
is an active admin (orders-only staff included, deactivated staff excluded).
Customers get no link and no hint.

**Why not the site header:** the header is part of the public pages, which are
rendered once and served to everyone (ISR). A per-user link would make every
public page render per request. "My account" in the header already leads to
the account page, which is per-user anyway.

## 2026-09-26 — Phase 9: SEO

- **Indexing only in real production:** `isIndexable()` is true only when
  `VERCEL_ENV=production` *and* `NEXT_PUBLIC_SITE_URL` is not a
  `*.vercel.app` address. Otherwise robots.txt is `Disallow: /` and every page
  is `noindex, nofollow`. Staging needs no flag and cannot be indexed; the
  production launch on a custom domain needs no flag either. If production
  ever runs on a vercel.app address, it will not be indexed (Phase 10 check).
- **No canonical in the layout:** it was inherited by every page, so `/login`
  declared the home page as its canonical. Indexable pages (home, category,
  product) set canonical + hreflang (ar, en, x-default → ar); private pages
  are noindex without a canonical.
- **Open Graph:** brand image `public/og.png` (1200×630, rendered by Chromium
  with the site's font so Arabic is shaped; `scripts/make-og-image.mjs`); the
  product image replaces it when a product has one.
- **Structured data:** home = Organization + WebSite with site search;
  category = BreadcrumbList + ItemList; product = Product (AggregateOffer in
  SDG) + BreadcrumbList. Validated against Google's required properties in
  tests/e2e/seo.spec.ts; every URL named must answer 200.

## 2026-09-26 — Phase 9: segment prefetch 404 = Next 16.3 per-locale inlining

**Root cause:** since 16.3 (`experimental.prefetchInlining`, on by default)
Next inlines a layout's prefetch data into the page when it is under 2 KB
gzip, and writes it to its own file otherwise, decided per param value. Our
`[locale]` layout (header + footer) is just over 2 KB in Arabic and just under
in English, so only `ar.segments/$d$locale.segment.rsc` existed; the client
router uses one route tree for both locales and asked for `/en`'s file → 404.
Found by bisecting our layout (without header+footer, neither file exists; with
either one alone, neither; with both, only `ar`).

**Fix:** `experimental.prefetchInlining: false`: every segment gets its own
file in both locales (verified: 276 prefetch requests over the flows that
used to 404, 0 errors). Cost measured: +44 KB background prefetch on the home
page after it has loaded, +14 KB on a product page; no effect on first paint.
Rejected: raising `maxSize` (the result would still depend on how many bytes
the banner and footer hold, and could flip again).

**Upstream:** a minimal app reproduces the asymmetric build output (only the
locale whose layout exceeds 2 KB gets a file) but not the 404 itself, so the
report is not filed yet. Revisit in Phase 10 / on Next upgrades.

## 2026-09-26 — Phase 9: accessibility and dark mode

- axe-core (`@axe-core/playwright`, dev dependency: the standard engine, no
  alternative without it) scans the main customer and admin pages in both
  languages and themes; serious/critical fail the test. Found and fixed:
  dark-mode brand-blue text at ≈ 3.3:1, orange text on white, the red banner
  text, links inside sentences distinguished by colour only, a scrollable
  table unreachable by keyboard, heading levels on list pages. Result: 0
  findings at any level.
- Brand colours are unchanged as surfaces in light mode. Dark mode uses a
  lighter tint of the brand blue (`oklch(0.72 0.15 262)`) with dark text on
  primary buttons; orange as *text* uses a darker `highlight-text` token in
  light mode; light-mode `destructive` is Tailwind red-700.
- Dev-only console warning on 404 pages ("Encountered a script tag"): React 19
  warns about next-themes' inline theme script when the not-found page renders
  on the client. No effect in production (the 404 page renders in the right
  theme); next-themes 0.4.6 is the latest release. Left as is.

## 2026-09-26 — Phase 9: measured, not assumed

- `scripts/measure-js.mjs`: gzip size of the scripts a page loads.
- `scripts/measure-perf.mjs`: Pixel 7, Slow 4G (150 ms RTT, 1.6 Mbps down) and
  4× CPU, cold cache, median of N runs; page bytes (Resource Timing up to the
  load event) separated from background prefetch. Limitation: Chrome does not
  apply the throttle's latency to the HTML document on localhost, so TTFB here
  excludes one round trip and Vercel's server time; Lighthouse on the real
  domain is a Phase 10 item.
- Query review: Supabase performance advisor on staging reports 16 unindexed
  foreign keys (all "who did it" columns never used as filters; they only
  slow down deleting a profile), 22 unused indexes (staging has no traffic
  yet) and two permissive SELECT policies on `profiles` (own row + staff).
  No action at MVP scale; re-run the advisor after a month of production use.

## 2026-09-26 — Phase 9: no loading boundary above guarded pages

**What:** `loading.tsx` exists only for `/search`. Account and admin pages have
none; in the admin, the section link that was tapped shows a pulsing dot
(`useLinkStatus`) until the page arrives.

**Why:** a loading boundary makes Next stream the page, so the HTTP status is
sent before the page runs. A page that ends in `notFound()` (another
customer's order or invoice, an admin section without the permission) then
answers **200** with the not-found content instead of **404**. The full e2e run
caught it: 9 tests that assert 404 failed with the boundaries in place, all
passed after removing them. A 404 that does not reveal the admin area matters
more than a skeleton. A test now asserts both the pending dot and the 404.

**Measured before removing it:** on the production build the skeleton appeared
79–120 ms after a tap while the server was held for 3 s; the pending dot
gives the same immediate feedback on admin links.
