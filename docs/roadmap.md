# Roadmap

One phase per session. Tick items as they land. Delivery window: 45 days from project start.

## Phase 0 — Architecture review (no application code)
Output: `docs/architecture.md`

- [x] Read `CLAUDE.md` and `docs/spec.md`
- [x] Requirements understanding (short)
- [x] Proposed architecture
- [x] Proposed database schema with relationships, indexes, constraints
- [x] Auth & authorization model (RLS strategy, admin permissions)
- [x] Critical flows: registration/OTP, KYC, order creation, status change, invoice
- [x] Risks, ambiguities, client dependencies
- [x] Recommended default for each open decision in spec §12
- [x] Folder structure
- [x] Implementation order
- [x] Wait for my approval before Phase 1 (approved 2026-09-23 with amendments, see `docs/decisions.md`)

## Phase 1 — Foundation
- [x] Next.js + TypeScript + Tailwind + shadcn/ui
- [x] next-intl, `/ar` and `/en`, dir switching, logical CSS properties
- [x] Dark mode, base layout, brand tokens (`#005CFF`, `#FF7A00`)
- [x] Supabase project wiring, env configuration, `.env.example`
- [x] Folder structure, lint/typecheck/build scripts

## Phase 2 — Database & security
- [x] Schema migrations, indexes, constraints, enums
- [x] RLS policies on every table
- [x] Storage buckets + policies (private KYC bucket)
- [x] Authorization helpers, permission checks
- [x] Audit log tables and write path
- [x] Tests: customer isolation, admin boundaries
- [x] **Blocking acceptance tests** (show failing before fix, passing after):
  - [x] Public `auth.signUp` closed: no account without a verified OTP
  - [x] Customer cannot modify `kyc_status`, any price column, or any order state via direct PostgREST
  - [x] Customer cannot read another customer's orders, receipts, invoices or KYC records via direct PostgREST

## Phase 3 — Auth & KYC
- [x] WhatsApp service interface + dev driver (moved from Phase 7)
- [x] Phone registration + password, OTP architecture (hashed, expiry, attempts, rate limits)
- [x] Login, configurable OTP policy
- [x] Password recovery
- [x] Google OAuth + account linking
- [x] Profiles
- [x] KYC upload (MIME/extension/size validation, EXIF stripping), statuses, admin review with signed URLs
- [x] Tests: OTP abuse, KYC authorization, document access

## Phase 4 — Catalog
- [x] Categories, products, variants, bilingual fields, visibility
- [x] Configurable required fulfillment fields per variant (dynamic rendering + server validation)
- [x] Product/category pages, search, filtering
- [x] SEO basics for public pages

## Phase 5 — Orders & payments
- [x] Order creation with server-side pricing and price snapshot (turn the Phase 4 `checkOrderDetails` step into order creation; purge `sensitive` fields at terminal status)
- [x] KYC threshold enforcement on the server
- [x] Bank transfer details, receipt upload, transaction number + duplicate detection (if approved)
- [x] Reference numbers, order statuses and transitions with audit entries
- [x] Tests: price tampering, KYC restriction, invalid transitions
- Note: receipt review exists as a DB function (`review_receipt`); its admin screen is part of the Phase 6 orders UI.

## Phase 6 — Admin dashboard
- [x] Orders: list, filters, search, detail, receipt view, status changes, internal notes
- [x] Products, categories, variants, prices, required fields (call `revalidatePath` for affected catalog pages; validate definitions with `fieldDefinitionsSchema`)
- [x] Customers and KYC queue
- [x] Comments moderation, FAQs, site settings
- [x] Admins and granular permissions
- [x] Audit log viewer
- [x] Also: product image upload (validated, re-encoded WebP), customer comments on product pages, home banner + FAQs + footer contacts from Settings, abuse limits as settings
- [x] Fixed: forms could submit natively (GET, values in URL) before hydration — found in Phase 6, affected Phase 3 auth forms

## Phase 7 — WhatsApp
- [x] Meta Cloud API driver (interface + dev driver already landed in Phase 3)
- [x] OTP, order status, KYC result templates (texts for Meta: docs/whatsapp-templates.md)
- [x] Webhook, `message_logs`, delivery status
- [x] Retries, failure handling, admin alerts, cost per message and monthly spend
- [x] KYC files whose post-review deletion failed: reviewer list + 24 h admin banner (done in the Phase 8 session, decisions.md 2026-09-29)
- Note: built against a fake Graph API; Meta credentials and template approval were not available. Real-API checks are in Phase 10.

## Phase 8 — Invoices
- [x] Sequential numbering at the database level (issued on completion; gapless under concurrency)
- [x] Invoice page, print styles
- [x] Arabic PDF export (evaluated: browser print; decisions.md 2026-09-29)
- [x] Invoice history and search (customer and admin), void and re-issue

## Phase 9 — UX, SEO, performance
- [x] Final responsive pass: every page (42, with real data) at 360 px in ar/en × light/dark, no horizontal overflow (tests/e2e/responsive.spec.ts); long user input (transaction numbers, comments) wraps
- [x] Accessibility: axe scan of the main customer and admin pages, ar/en × light/dark, 0 findings at any level (tests/e2e/a11y.spec.ts); contrast fixes in both themes, keyboard-scrollable tables
- [x] Empty/loading/error states: loading skeleton for search; the tapped admin section shows it is loading; account and admin have no loading boundary so guarded pages keep answering 404 (decisions.md 2026-09-26); empty and error states swept
- [x] Segment prefetch 404: root cause found (Next 16.3 inlines a layout's prefetch data only under 2 KB gzip, per locale; the router shares one tree) and fixed with `experimental.prefetchInlining: false`; partial upstream repro (decisions.md 2026-09-26)
- [x] Sitemap, robots, canonical, hreflang, Open Graph (+ brand image), structured data (Organization, WebSite search, Breadcrumb, ItemList, Product), validated with hidden items absent (tests/e2e/seo.spec.ts); non-production deployments are noindex
- [x] Image optimization (Phase 6), pagination (search, admin lists), query review (Supabase performance advisor on staging; decisions.md 2026-09-26)
- [x] Client JS on auth pages: login 306.6 → 206.3 KB gzip (Zod and React Hook Form no longer shipped; shared rules in lib/validation/auth-rules.ts)
- [x] ~~Product images via `next/image`~~ — superseded in Phase 6: images are re-encoded to fixed-size WebP at upload and served directly (decisions.md 2026-09-27)
- [x] Dark mode polish, RTL/LTR review (screenshots of every page reviewed; admin section bar keeps the current section in view on phones)
- [x] Staff entry point to the dashboard (account page, staff only) — Hassan, staging review
- [x] Mobile performance measured (Slow 4G + 4× CPU) on home, product, login; before/after (scripts/measure-perf.mjs)

## Phase 10 — QA & deployment
- [ ] Bootstrap the owner account (one SQL insert after the client registers; decisions.md 2026-09-27)
- [ ] Confirm `pg_graphql` is disabled on the hosted project (migration drops it)
- [ ] Revisit admin 2FA (deferred): the dashboard is now live with password-only admin sign-in
- [ ] Security review: RLS, authorization, file access, server-side validation
- [ ] Full test run, mobile testing, RTL and LTR testing
- [ ] SEO and performance validation on the real domain: Lighthouse mobile on production (the local numbers exclude the HTML request's network latency and Vercel's server time); submit the sitemap in Google Search Console; check robots.txt allows crawling (it does only on Vercel production with a non-*.vercel.app NEXT_PUBLIC_SITE_URL)
- [ ] Revisit `experimental.prefetchInlining: false` when Next fixes per-locale segment inlining upstream (decisions.md 2026-09-26)
- [ ] Production environment, deployment checklist, placeholder-replacement check
- [ ] Hosted Supabase auth config applied (`supabase config push` / dashboard): email provider off, anonymous off, phone provider on with the Send SMS hook (refuses all), `before_user_created` hook, manual linking on, min password 10; verified by running acceptance test 1 against the hosted project
- [ ] Google OAuth credentials configured; real Google sign-in → incomplete account → phone OTP → complete, tested end to end (not testable locally)
- [ ] `OTP_HMAC_PEPPER` generated for production (64 random hex chars), `WHATSAPP_DRIVER=meta`
- [ ] WhatsApp against the real Meta API: the 17-point checklist in docs/whatsapp-templates.md (templates approved in ar/en, button format, API version, error codes, webhook signature and pricing fields, rates, scheduler)
- [ ] Invoices on real phones: "Print / Save as PDF" on Android Chrome and iPhone Safari produces a one-page A4 PDF with correct Arabic (only desktop Chromium was tested); also Firefox desktop
- [ ] WhatsApp setup on the hosted project (docs/handover.md): Vercel variables, webhook subscription then `WHATSAPP_VERIFY_TOKEN` removed, the two Vault secrets for the retry scheduler, Sudan rates entered
- [ ] Manual backup procedure (DB dump + storage export) documented in the handover guide
- [ ] User guide (Arabic) for the client, source handover via GitHub + archive
