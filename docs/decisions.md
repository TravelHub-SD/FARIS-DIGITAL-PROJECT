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
