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
- [ ] Wait for my approval before Phase 1

## Phase 1 — Foundation
- [ ] Next.js + TypeScript + Tailwind + shadcn/ui
- [ ] next-intl, `/ar` and `/en`, dir switching, logical CSS properties
- [ ] Dark mode, base layout, brand tokens (`#005CFF`, `#FF7A00`)
- [ ] Supabase project wiring, env configuration, `.env.example`
- [ ] Folder structure, lint/typecheck/build scripts

## Phase 2 — Database & security
- [ ] Schema migrations, indexes, constraints, enums
- [ ] RLS policies on every table
- [ ] Storage buckets + policies (private KYC bucket)
- [ ] Authorization helpers, permission checks
- [ ] Audit log tables and write path
- [ ] Tests: customer isolation, admin boundaries

## Phase 3 — Auth & KYC
- [ ] Phone registration + password, OTP architecture (hashed, expiry, attempts, rate limits)
- [ ] Login, configurable OTP policy
- [ ] Password recovery
- [ ] Google OAuth + account linking
- [ ] Profiles
- [ ] KYC upload (MIME/extension/size validation, EXIF stripping), statuses, admin review with signed URLs
- [ ] Tests: OTP abuse, KYC authorization, document access

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
- [ ] Service abstraction + dev driver
- [ ] OTP, order status, KYC result templates
- [ ] Webhook, `message_logs`, delivery status
- [ ] Retries, failure handling, admin alerts

## Phase 8 — Invoices
- [ ] Sequential numbering at the database level
- [ ] Invoice page, print styles
- [ ] Arabic PDF export (evaluate options first)
- [ ] Invoice history and search

## Phase 9 — UX, SEO, performance
- [ ] Final responsive pass, accessibility, empty/loading/error states
- [ ] Sitemap, robots, canonical, hreflang, Open Graph, structured data
- [ ] Image optimization, pagination, query review
- [ ] Dark mode polish, RTL/LTR review

## Phase 10 — QA & deployment
- [ ] Security review: RLS, authorization, file access, server-side validation
- [ ] Full test run, mobile testing, RTL and LTR testing
- [ ] SEO and performance validation
- [ ] Production environment, backups, deployment checklist
- [ ] User guide (Arabic) for the client, source handover via GitHub + archive
