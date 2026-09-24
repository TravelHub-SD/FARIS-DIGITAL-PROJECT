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
- [ ] Categories, products, variants, bilingual fields, visibility
- [ ] Configurable required fulfillment fields per variant (dynamic rendering + server validation)
- [ ] Product/category pages, search, filtering
- [ ] SEO basics for public pages

## Phase 5 — Orders & payments
- [ ] Order creation with server-side pricing and price snapshot
- [ ] KYC threshold enforcement on the server
- [ ] Bank transfer details, receipt upload, transaction number + duplicate detection (if approved)
- [ ] Reference numbers, order statuses and transitions with audit entries
- [ ] Tests: price tampering, KYC restriction, invalid transitions

## Phase 6 — Admin dashboard
- [ ] Orders: list, filters, search, detail, receipt view, status changes, internal notes
- [ ] Products, categories, variants, prices, required fields
- [ ] Customers and KYC queue
- [ ] Comments moderation, FAQs, site settings
- [ ] Admins and granular permissions
- [ ] Audit log viewer

## Phase 7 — WhatsApp
- [ ] Meta Cloud API driver (interface + dev driver already landed in Phase 3)
- [ ] OTP, order status, KYC result templates
- [ ] Webhook, `message_logs`, delivery status
- [ ] Retries, failure handling, admin alerts
- [ ] Retry job for KYC files whose post-review deletion failed

## Phase 8 — Invoices
- [ ] Sequential numbering at the database level
- [ ] Invoice page, print styles
- [ ] Arabic PDF export (evaluate options first)
- [ ] Invoice history and search

## Phase 9 — UX, SEO, performance
- [ ] Final responsive pass, accessibility, empty/loading/error states
- [ ] Known issue (found in Phase 2 browser run): background segment prefetch `/en?_rsc=…` (`Next-Router-Segment-Prefetch: /$d$locale`) returns 404 because `next build` does not emit `en.segments/$d$locale.segment.rsc` (the `ar` one exists; deterministic across clean builds; Next 16.3 vary-params segment sharing). Navigation itself returns 200. Reproduce with a minimal app; fix or report upstream
- [ ] Sitemap, robots, canonical, hreflang, Open Graph, structured data
- [ ] Image optimization, pagination, query review
- [ ] Dark mode polish, RTL/LTR review

## Phase 10 — QA & deployment
- [ ] Security review: RLS, authorization, file access, server-side validation
- [ ] Full test run, mobile testing, RTL and LTR testing
- [ ] SEO and performance validation
- [ ] Production environment, deployment checklist, placeholder-replacement check
- [ ] Hosted Supabase auth config applied (`supabase config push` / dashboard): email provider off, anonymous off, phone provider on with the Send SMS hook (refuses all), `before_user_created` hook, manual linking on, min password 10; verified by running acceptance test 1 against the hosted project
- [ ] Google OAuth credentials configured; real Google sign-in → incomplete account → phone OTP → complete, tested end to end (not testable locally)
- [ ] `OTP_HMAC_PEPPER` generated for production (64 random hex chars), `WHATSAPP_DRIVER=meta`
- [ ] Manual backup procedure (DB dump + storage export) documented in the handover guide
- [ ] User guide (Arabic) for the client, source handover via GitHub + archive
