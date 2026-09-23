# Faris Digital — Product Specification

Source of truth for requirements. If something here conflicts with a request in chat, raise it instead of silently choosing.

## 1. Product
A bilingual (Arabic/English) marketplace selling digital products and services in Sudan:
game top-ups, Starlink products/services, mobile airtime, app subscriptions, and other digital services added later.

Orders are fulfilled **manually** by admins. Payment is **manual bank transfer**: the customer uploads a transfer receipt, the admin verifies it and fulfills the order.

## 2. Actors
- **Visitor** — browses catalog, reads FAQs, cannot order.
- **Customer** — account holder; orders, uploads receipts, uploads KYC documents, comments, sees own orders/invoices.
- **Admin** — manages the platform, with granular permissions (not every admin has full access).
- **Owner** — the client (Fares Hassan); super admin.

## 3. Customer-facing features
### Home
Responsive layout, header with logo, category links, search, language switch, light/dark toggle, login/account, order button. Editable promo banner, main categories, most-ordered products, FAQ section, footer with contact + social links + policy pages.

### Catalog
- Category pages for each section (games, Starlink, airtime, app subscriptions, future ones).
- Product page: image, name, description, price, available variants/packages.
- Search and filtering by category and price.
- Per-product comments section tied to customer accounts (custom-built; WordPress plugins such as wpDiscuz are not applicable to this stack).

### Account
- Registration: phone and/or WhatsApp number + password, verified by a WhatsApp OTP.
- Login: phone + password, plus OTP when the configured policy requires it.
- Google OAuth login (handle the case where the same person already registered by phone).
- Password recovery via WhatsApp OTP.
- "My account": personal data, KYC status, order history and statuses.

### KYC (identity verification)
- Customer uploads an identity document.
- Statuses: `none`, `pending`, `verified`, `rejected` (with rejection reason), shown to the customer.
- Verification is **manual** by an admin — no third-party verification service.
- Optional for orders below a configurable amount, mandatory above it. **Enforced server-side**, never only in the UI.

### Ordering
- Select product → variant/package → fill the fulfillment fields required by that variant (e.g. player ID, server, account ID, phone) — fields are configurable per variant, not a single hardcoded form.
- Server recomputes the authoritative price from the database, checks the variant is active, checks KYC requirements, then creates the order.
- Display the owner's bank transfer details; customer uploads the transfer receipt.
- Order reference number returned and shown in "My account".
- Order statuses: `new`, `processing`, `completed`, `cancelled` (architecture must allow more later).
- WhatsApp message to the customer on every status change.

### Static pages
Contact + site info, About, FAQ, Terms & Privacy (client supplies the texts).

## 4. Admin dashboard
- **Orders**: table with search/filter by status, date, customer, reference number, amount; order detail with customer data, fulfillment data, transfer receipt and transaction details; status changes; internal notes (never visible to customers).
- **Products & categories**: create/edit/archive, activate/deactivate any product, category or service, variants, prices, images, bilingual names and descriptions, required fulfillment fields per variant.
- **Customers & KYC**: customer list and profiles, KYC review queue, document preview via short-lived signed URL, approve/reject with reason, set the KYC threshold amount.
- **Invoices**: generate per order, sequential number, view, print, PDF export, searchable list.
- **Comments**: list, hide, delete, spam control.
- **FAQs**: create/edit/delete, Arabic and English.
- **Settings**: contact details, bank accounts, promo banner, logo, KYC threshold, other configurable values.
- **Admins & permissions**: add/remove admins, per-area permissions (orders, products, KYC, invoices, comments, customers, settings).
- **Audit log**: who did what, when, previous/new state — order status changes, KYC decisions, price changes, deletions, permission changes, invoice generation. Append-oriented; normal admins cannot tamper with it.

## 5. Data model (starting point — improve naming if it helps, keep the business meaning)
`profiles`, `kyc_documents`, `categories`, `products`, `product_variants`, `orders`, `payment_receipts`, `invoices`, `comments`, `admins`, `permissions`, `otp_codes`, `message_logs`, `faqs`, `site_settings`, `audit_logs`.

Notes:
- Bilingual content uses paired columns (`name_ar` / `name_en`, `description_ar` / `description_en`) rather than a translation table. Fall back to the other language when one is empty.
- Orders store a **price snapshot** at creation time; later price edits must not change existing orders or invoices.
- `product_variants.required_fields` is JSON describing the fulfillment fields to render and validate.
- Invoice numbers come from a database sequence/function — never computed in application code.
- `payment_receipts` should support a transaction/reference number with duplicate detection (see open decisions).

## 6. WhatsApp integration
Meta WhatsApp Cloud API, direct (cheapest option: roughly $0.004 per message for Sudan's pricing region; no monthly subscription).

- Templates needed: authentication (OTP), order status update, KYC result. All require Meta approval before use.
- Wrap in a service interface; business logic must not call the Meta API directly.
- `message_logs`: phone, message type, Meta message ID, delivery status, estimated cost, timestamps.
- Webhook for delivery/status updates.
- On failure: safe retry policy, record the failure, alert admins for manual handling.
- Dev driver logs codes locally so development is not blocked by template approval. Never active in production.

## 7. Internationalization
- `/ar` (RTL) and `/en` (LTR), correct `<html dir>`, CSS logical properties (`margin-inline`, `padding-inline`, `inset-inline`) instead of left/right.
- All UI strings translatable; admin content bilingual with fallback.
- Interface translation is the developer's responsibility; product content in both languages is the client's responsibility (per contract).
- `hreflang`, per-language metadata, localized sitemap.

## 8. SEO & performance
Server-rendered public pages, per-language metadata, product/category metadata, sitemap, robots.txt, canonical URLs, Open Graph, structured data where it fits.
Audience is often on weak connections: optimize images, minimize client JS on public pages, paginate, use efficient queries. Do not add caching layers before a real bottleneck exists.

## 9. UX requirements
Modern marketplace feel, Arabic-first quality, correct RTL, dark mode, clean dashboard, clear order status, accessible forms, obvious CTAs, good empty/loading/error/success states, confirmation dialogs for destructive actions. Use the brand colors; avoid a generic template look.

## 10. Client-provided content and accounts
- Bank accounts (displayed to customers), account holder **فارس حسن عمر خالد**:
  - Bank of Khartoum (Bankak) — `3121407` — Saad Gishra branch
  - Faisal Islamic Bank (Fawry) — `51575057` — Port Sudan branch
  - Bank of Nile (Sahel) — `27098` — Bahri Industrial branch
- Social accounts (Facebook, Instagram, X/Twitter, Telegram): `@farishassanz`
- Pending from client: logo and brand assets, product/category content in both languages, policy texts, KYC threshold amount, domain, Meta Business account + dedicated WhatsApp number.

## 11. Out of scope (separate agreement, do not build)
Wallet / internal user balance, direct payment gateways, automatic integration with top-up providers or external APIs, automated identity verification, bulk marketing WhatsApp messages, mobile app, sales reports/analytics dashboard, points or coupon system, logo and brand identity design, product content writing.

## 12. Open decisions (ask before assuming)
1. **Currency** — SDG, USD, or both with a conversion rate? Affects prices, KYC threshold, invoices. **Blocking for the schema.**
2. **OTP policy** — every login, or only registration and password reset? Recommended default: registration and reset only (cost and friction).
3. **ID document retention** — delete after approval and keep only the verdict, fixed retention window, or keep indefinitely? Recommended default: delete after approval.
4. **Arabic PDF invoices** — browser print, server-side generation with embedded Arabic font, or external service. Evaluate before implementing; broken Arabic shaping is not acceptable.
5. **Transfer receipts** — image only, or transaction number with duplicate detection? Recommended: add the number with duplicate detection.
6. **Admin 2FA** — from day one or later?
7. **Order reference format** — proposed: short prefixed sequence, human-readable over WhatsApp.
