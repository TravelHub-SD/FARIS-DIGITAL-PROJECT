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
Done without the client (2026-09-26):
- [x] Content-Security-Policy with a per-request nonce on every page; injected inline script proven blocked on public, customer and admin pages; every page × ar/en × role has zero violations, in dev and on the production build (decisions.md 2026-09-26)
- [x] Security review: RLS, authorization, file access, server-side validation, accepted risks re-evaluated (docs/security-review.md); fixed F1 comments table public, F2 IPv6 /64 rate-limit bypass, F3 pg_net schema, F4 silent OTP budget exhaustion, HSTS; new pgTAP guards
- [x] `pg_graphql` confirmed absent on the hosted staging project (production: runbook step 2.3)
- [x] Revisit admin 2FA: recommendation is TOTP for all staff before launch (security-review.md) — approved by Hassan 2026-09-28
- [x] Admin TOTP (Phase 10b): `aal2` required by `admin_assurance_ok()`, proven by a direct PostgREST call with a password-only staff session; set-up and code screens in Arabic and English; backup authenticator; owner reset; break-glass SQL for the owner; wrong-code limit
- [x] Vercel functions pinned to `fra1`, next to the Frankfurt database (`vercel.json`; staging ran in `iad1`)
- [x] `main` branch for production deployments
- [x] Launch runbook (docs/launch-runbook.md): client-owned Supabase + Vercel, migrations only, auth settings, secrets, WhatsApp + scheduler, Google OAuth, owner bootstrap, demo-data proof, backups, rollback
- [x] Manual backup procedure (DB dump + storage export), commands run on the local stack
- [x] Arabic operations guide for the client (docs/handover.md): daily work, every admin screen, backups, what to do when something fails
- [x] Full test run (unit + integration, pgTAP, e2e on dev and on the production build)
- [x] About / Terms / Privacy pages (spec §3, Phase 10b): editable in the dashboard (settings permission, as FAQs), bilingual with fallback, plain text, footer + sitemap when published
- [ ] Lighthouse mobile on staging: blocked here (the container cannot reach `*.vercel.app`, and staging is behind Vercel Authentication); measured on the local production build instead
- [ ] Revisit `experimental.prefetchInlining: false` when Next fixes per-locale segment inlining upstream (decisions.md 2026-09-26)
- [ ] Restore drill of a backup into an empty hosted project (runbook step 12)

Depends on the client (runbook §0):
- [ ] Client-owned Supabase (Pro) and Vercel (Pro) projects; payment card
- [ ] Domain; production deploy from `main`; SEO and performance on the real domain: Lighthouse mobile, sitemap in Google Search Console, robots.txt allows crawling (only on Vercel production with a non-*.vercel.app `NEXT_PUBLIC_SITE_URL`)
- [ ] Hosted production auth config (runbook step 3) and the sign-up checks with curl
- [ ] Bootstrap the owner account (runbook step 8)
- [ ] Google OAuth credentials; real Google sign-in → incomplete account → phone OTP → complete, end to end
- [ ] Production secrets generated (`OTP_HMAC_PEPPER`, `WHATSAPP_DISPATCH_SECRET`), `WHATSAPP_DRIVER=meta`
- [ ] WhatsApp against the real Meta API: the 17-point checklist in docs/whatsapp-templates.md (templates approved in ar/en, button format, API version, error codes, webhook signature and pricing fields, rates, scheduler)
- [ ] WhatsApp setup on the hosted project (runbook step 6): Vercel variables, webhook subscription then `WHATSAPP_VERIFY_TOKEN` removed, the two Vault secrets, Sudan rates
- [ ] Real content: catalog, rate, KYC threshold, bank branch names confirmed, business name, logo, texts for About/Terms/Privacy (entered in *Pages*)
- [ ] Authenticator app on every staff phone; the owner adds a backup authenticator on a second phone
- [ ] Staging: the demo owner and orders staff set up an authenticator at their next dashboard visit
- [ ] Real phones (Hassan): invoice "Save as PDF" on Android Chrome (and iPhone Safari, Firefox desktop); a full customer order on a Sudanese mobile network
- [ ] Source handover via GitHub (client-owned repository or transfer) + archive

## Phase 11 — Storefront redesign + shopping cart (Hassan, 2026-09-30)
- [x] Stage 1: design system, 360px Arabic mockups (light/dark), cart architecture recommendation — approved; mockups with the client
- [x] Stage 2: cart table (RLS), orders with line items, existing orders migrated (byte-identical), per-line rounding, one checkout = one order, KYC on the order total + rolling window setting (dashboard, audited), tests + planted violations
- [ ] Stage 3: mobile shell (bottom nav, compact header, WhatsApp button), home (banner slider, sections of square icons, sticky category bar), category and product UI; category sections and "New" / compare-at price in the data model — waits for the client's feedback on the mockups
- [ ] Stage 4: cart, checkout, order and invoice UI, admin line items
- [ ] Stage 5: account pages and admin pass; full verification (check, all suites, 360px sweep, axe, CSP sweep, JS budget before/after)
