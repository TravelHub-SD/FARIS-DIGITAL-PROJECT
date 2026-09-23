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
- **Decision:** a receipt upload requires the image, the destination bank account, and the transaction/reference number. The number is normalised and must be unique per bank account among non-rejected receipts (hard block, DB unique index). The image sha256 is stored; reuse on another order is flagged to the admin, not blocked.
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
