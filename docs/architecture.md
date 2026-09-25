# Phase 0 — Architecture Review

Status: **approved 2026-09-23 with amendments.** Where this document and `docs/decisions.md` disagree, `decisions.md` wins. Amendments in short:
- Currency: USD pricing base + admin-set rate, SDG charge, immutable snapshot (option B).
- Admin 2FA **deferred** (accepted risk); `is_admin()` keeps a single assurance-level check point for later.
- ID files deleted after approval **or** rejection.
- Development on free tiers only: no automatic backups, the database may be paused/cold.
- WhatsApp interface + dev driver in Phase 3.
Inputs: `CLAUDE.md`, `docs/spec.md`, `docs/roadmap.md`, `docs/decisions.md` (2026-09-23).

---

## 0. First question: currency (blocks the schema)

Nothing can be priced, KYC-thresholded or invoiced until this is answered.

**Facts we already have:** all three receiving accounts (Bankak, Fawry, Sahel) are local SDG accounts, so the customer **pays in SDG**. What we don't know is **what the price is based on**. Game top-ups, Starlink and subscriptions are bought by Fares in USD, and SDG loses value quickly.

| Option | Model | Cost |
|---|---|---|
| **A. SDG only** | Admin enters SDG prices, customer pays SDG | Simplest. Fares must manually re-price every variant each time the rate moves |
| **B. USD base, SDG charge** | Variant priced in USD (or SDG). One owner-maintained `usd_sdg_rate` setting. Server computes the SDG price at order time and snapshots the rate | +1 settings field, +3 order snapshot columns. One rate change re-prices the whole catalog |
| C. Customer chooses currency | Two payment rails | Rejected: there is no USD receiving account |

**Recommendation:** go with B if Fares's costs are in USD, which they almost certainly are. Otherwise use A. **Either way, the schema below carries an explicit `currency` on every money snapshot and the fx fields are nullable.** That way A→B is additive later, not a rewrite.

**Questions for Fares (today):**
1. هل الأسعار الأساسية بتتحسب بالدولار ولا بالجنيه؟
2. العميل بيدفع بالجنيه دائماً (تحويل بنكي محلي)؟
3. لو الأساس دولار: مين بيحدد سعر الصرف، وكل كم بيتغير؟ (فارس يدوياً من لوحة التحكم هو المقترح)
4. حد الـ KYC: بالجنيه ولا بالدولار؟ وكم؟

Money rules regardless of answer: `numeric(14,2)` in Postgres. All arithmetic happens in SQL (never JS floats). TS only formats with `Intl.NumberFormat`, using Latin digits (`ar-SD-u-nu-latn`) for prices, phones and references, because people copy those into WhatsApp and banking apps.

---

## A. Requirements understanding

A bilingual (AR-first/RTL + EN) catalog of digital products. Customers pick one variant, fill variant-specific fulfillment fields and get a price the **server** computes. They pay by **manual bank transfer** and upload a receipt. Admins verify the receipt against the bank app and fulfil manually. Status changes notify the customer over WhatsApp. Identity verification is manual and becomes mandatory above a configurable amount. Admins hold granular per-area permissions, the owner holds all of them, and every sensitive action is audited. No wallet, no gateway, no provider APIs.

The money and data risk sits in five places: **price integrity, KYC enforcement, receipt fraud, identity-document leakage, and WhatsApp budget abuse.** The design below is built around those.

Assumptions (flag if wrong):
- **One variant per order, no cart.** A `quantity` column is allowed (1–10) for cases like "3× the same card."
- The verified WhatsApp number **is** the account phone. Google users must verify one before ordering.
- Customers cannot cancel orders themselves in the MVP. Admins cancel.

---

## B. Proposed architecture

```
Browser ──HTTPS──► Vercel (Next.js App Router, one app)
                     ├─ Server Components  (public pages, SSR, minimal client JS)
                     ├─ Server Actions     (all mutations; each re-checks auth + permission)
                     ├─ Route handlers     (/api/whatsapp/webhook, /api/whatsapp/dispatch, /auth/callback)
                     └─ server/whatsapp    (interface → MetaDriver | DevDriver)
                              │
                              ▼
                     Supabase
                       ├─ Auth    (identities, sessions, Google OAuth, TOTP MFA for admins)
                       ├─ Postgres (RLS on everything; money/state logic in SECURITY DEFINER functions)
                       └─ Storage (private: kyc-documents, payment-receipts; public: public-assets)
                              │
                     Meta WhatsApp Cloud API ◄── outbound templates / inbound status webhook
```

**Key principles**

1. **Assume the browser talks to PostgREST directly.** The anon key is public, so any logged-in user can call `/rest/v1/*` and `/rpc/*` with their own JWT, whatever our UI does. Consequences:
   - Customers get **no INSERT/UPDATE on money tables** (`orders`, `payment_receipts`, `invoices`). Those writes go only through `SECURITY DEFINER` functions that recompute everything.
   - Profile updates are limited by **column-level GRANTs** (`grant update (full_name, locale) on profiles`), because RLS can't restrict columns. Without this, a customer could set their own `kyc_status = 'verified'`.
   - Internal tables (`otp_codes`, `rate_limit_events`, `invoice_counters`) live in a **`private` schema that is not exposed** through the Data API.
2. **Three Supabase clients, with strict boundaries:**
   - `lib/supabase/server.ts`: user-session client (cookies). **Default everywhere.** RLS applies and `auth.uid()` is set, so audit triggers see the real actor.
   - `lib/supabase/browser.ts`: session refresh and OAuth redirect only. No data writes.
   - `lib/supabase/admin.ts`: `service_role`, marked `import 'server-only'`. Allowed **only** in: OTP flow (user creation, password reset), the file-ingest pipelines (writing to private buckets), the WhatsApp webhook/retry job and scheduled purges. A lint rule (`no-restricted-imports`) keeps it out of everywhere else.
   - **Admin mutations never use service_role.** They go through the admin's own session, so RLS, `aal2` and audit attribution all apply.
3. **Server Actions are public HTTP endpoints.** Every action begins with `requireUser()` / `requirePermission('orders')`. Page-level guards are UX only.
4. **The database is the last line.** Price, KYC threshold, transitions, invoice numbers and permissions are all enforced in Postgres, so a bug in TS can't bypass them.
5. **No extra infrastructure.** No Redis, queue or separate backend. Rate limits and the WhatsApp retry state live in Postgres tables. Retries are driven by `pg_cron` → `pg_net` calling the app (Phase 7; Vercel Cron runs only daily on the free plan).

**New dependencies beyond the stack (with reasons):**
- `sharp`: re-encode uploaded images. This strips EXIF and neutralises polyglot files. Next already uses it.
- `server-only`: compile-time guard for secret modules.
- `vitest`: unit tests.
- `pgTAP`, via `supabase test db`: RLS tests.
- Optional **Cloudflare Turnstile** (script tag, no npm dependency) on OTP request, to protect the WhatsApp budget. See F.

---

## C. Database schema

Conventions:
- `uuid` PKs (`gen_random_uuid()`), `timestamptz` everywhere (display in `Africa/Khartoum`).
- `created_at`/`updated_at` with an `updated_at` trigger.
- Paired `_ar`/`_en` columns with `check (coalesce(name_ar, name_en) is not null)`.
- Soft archive (`archived_at`) for catalog rows referenced by orders; FKs from orders are `on delete restrict`.
- Enums are used for stable sets. **Order status is a lookup table**, because Postgres enums can't drop values, and new values can't be used in the same transaction that adds them.

### Enums
```
kyc_status      : none | pending | verified | rejected
kyc_doc_type    : national_id | passport | driving_license
review_status   : pending | accepted | rejected        -- receipts & kyc submissions
app_permission  : orders | products | kyc | customers | invoices | comments | settings
otp_purpose     : register | reset_password | link_phone | change_phone
message_type    : otp | order_status | kyc_result
message_status  : queued | sent | delivered | read | failed
invoice_status  : issued | void
comment_status  : visible | hidden
```
`admins` management and audit-log reading are **owner-only**, not grantable permissions. FAQs, banner and bank accounts fall under `settings`.

### Identity & access
| Table | Key columns | Constraints / indexes |
|---|---|---|
| `profiles` | `id` (PK, FK `auth.users` cascade), `full_name`, `phone_e164`, `phone_verified_at`, `locale` (`ar`/`en`), `kyc_status` (default `none`), `kyc_rejection_reason`, `is_blocked` | `unique(phone_e164) where phone_e164 is not null`; check E.164 format; created by trigger on `auth.users` insert; **column grants**: authenticated may update only `full_name, locale` |
| `admins` | `user_id` (PK, FK profiles), `is_owner`, `is_active`, `created_by` | `unique(is_owner) where is_owner` (single owner); trigger forbids deactivating/deleting the owner |
| `admin_permissions` | `admin_id`, `permission app_permission`, `granted_by`, `granted_at` | PK `(admin_id, permission)` |

### KYC
| Table | Key columns | Constraints / indexes |
|---|---|---|
| `kyc_submissions` (spec: `kyc_documents`) | `id`, `user_id`, `doc_type`, `status review_status`, `storage_path` (nullable after purge), `file_sha256`, `mime`, `size_bytes`, `rejection_reason`, `reviewed_by`, `reviewed_at`, `file_deleted_at` | `unique(user_id) where status='pending'` (one open submission); `check (status <> 'rejected' or rejection_reason is not null)`; index `(status, created_at)` for the admin queue |

`profiles.kyc_status` is denormalised for fast checks. Only the `submit_kyc`/`review_kyc` functions write it.

### Catalog
| Table | Key columns | Constraints / indexes |
|---|---|---|
| `categories` | `id`, `slug`, `name_ar/en`, `description_ar/en`, `image_path`, `sort_order`, `is_active`, `archived_at` | `unique(slug)`; index `(is_active, sort_order)` |
| `products` | `id`, `category_id` (FK restrict), `slug`, `name_ar/en`, `description_ar/en`, `image_path`, `is_active`, `archived_at`, `completed_orders_count`, `search_text` (generated) | `unique(slug)`; index `(category_id) where is_active`; **GIN `pg_trgm` on `search_text`** |
| `product_variants` | `id`, `product_id`, `name_ar/en`, `price numeric(14,2)`, `price_currency` (`SDG`[/`USD` if option B]), `required_fields jsonb`, `max_quantity`, `is_active`, `sort_order`, `archived_at` | `check (price > 0)`; `check (jsonb_typeof(required_fields)='array')`; index `(product_id) where is_active` |

- `search_text` is generated by an IMMUTABLE `normalize_ar()` function. It folds أ/إ/آ→ا, ة→ه and ى→ي, and strips tashkeel and tatweel, then lowercases. Arabic search without this misses obvious matches.
- `required_fields` item shape (validated by a Zod meta-schema on admin save): `{ key, type: text|number|phone|email|select, label_ar, label_en, required, min_length?, max_length?, pattern?, options?, sensitive? }`.

### Orders & payments
| Table | Key columns | Constraints / indexes |
|---|---|---|
| `order_statuses` | `code` PK, `name_ar/en`, `is_terminal`, `notify_customer`, `sort_order` | seeded: `new`, `processing`, `completed`, `cancelled` |
| `order_status_transitions` | `from_status`, `to_status` | PK both; seeded: new→processing, new→cancelled, processing→completed, processing→cancelled |
| `orders` | `id`, `reference`, `user_id`, `variant_id` (FK restrict), `status` (FK `order_statuses`), **snapshot:** `product_name_ar/en`, `variant_name_ar/en`, `unit_price`, `quantity`, `total_amount`, `currency`, [`base_price`, `base_currency`, `fx_rate` — nullable, option B], `fulfillment_fields` (definition snapshot), `fulfillment_data jsonb`, `kyc_required bool`, `idempotency_key uuid`, `completed_at`, `cancelled_at` | `unique(reference)`; `unique(user_id, idempotency_key)`; `check (total_amount = unit_price * quantity)`; `check (quantity between 1 and 10)`; indexes `(user_id, created_at desc)`, `(status, created_at desc)`, `(created_at desc)` |
| `order_status_history` | `id`, `order_id`, `from_status`, `to_status`, `changed_by`, `customer_note`, `created_at` | index `(order_id, created_at)`; visible to the order owner |
| `order_internal_notes` | `id`, `order_id`, `author_id`, `body` | **separate table**, so RLS can't accidentally expose it to customers |
| `bank_accounts` | `id`, `bank_name_ar/en`, `account_number`, `account_holder`, `branch_ar/en`, `is_active`, `sort_order` | seeded from spec §10 |
| `payment_receipts` | `id`, `order_id`, `user_id`, `bank_account_id`, `transaction_ref`, `transaction_ref_norm` (generated: trim, upper, strip spaces/dashes), `amount_claimed`, `transferred_at`, `storage_path`, `file_sha256`, `status review_status`, `rejection_reason`, `reviewed_by`, `reviewed_at` | **`unique(bank_account_id, transaction_ref_norm) where status <> 'rejected'`** (hard block); index `(file_sha256)` (soft flag); `unique(order_id) where status='pending'` |
| `invoices` | `id`, `invoice_number`, `order_id`, `status invoice_status`, `issued_at`, `issued_by`, `currency`, `total_amount`, `snapshot jsonb` (seller, bank, customer, lines, totals), `void_reason`, `voided_by`, `voided_at` | `unique(invoice_number)`; `unique(order_id) where status='issued'`; trigger: rows are immutable except `issued → void` |
| `private.invoice_counters` | `year` PK, `last_value` | gapless: `update … set last_value = last_value+1 returning` inside the issuing transaction (sequences leave gaps on rollback) |

### Content & settings
| Table | Notes |
|---|---|
| `comments` | `product_id`, `user_id`, `body` (`check length 1..1000`), `status comment_status`, `hidden_by`, `hidden_reason`; index `(product_id, created_at desc) where status='visible'`; trigger rate-limits to 5 per 10 min per user |
| `faqs` | `question_ar/en`, `answer_ar/en`, `sort_order`, `is_published` |
| `app_settings` | **single typed row** (`id boolean pk default true check (id)`), not key/value: `kyc_threshold_amount numeric(14,2) check (>=0)`, `kyc_threshold_currency`, [`usd_sdg_rate`, `usd_sdg_rate_updated_at` — option B], `otp_login_policy` (`never`), `allowed_phone_country_codes text[] default '{249}'`, `otp_daily_budget int`, contact fields, `social_links jsonb`, banner fields (`banner_title_ar/en`, `banner_image_path`, `banner_link`, `banner_is_active`), `logo_path`. Typed columns mean a bad value fails at write time, not at order time |

Policy/about/terms texts: MDX files in the repo per locale for the MVP (the client supplies them once). An admin-editable `pages` table is a cheap later add if Fares wants to edit them himself.

### Messaging, security, audit
| Table | Notes |
|---|---|
| `private.otp_codes` | `phone_e164`, `purpose`, `code_hash` (HMAC-SHA256 with server pepper over `phone|purpose|code`), `expires_at` (now+5 min), `attempts`, `max_attempts` (5), `consumed_at`, `ip inet`; index `(phone_e164, purpose, created_at desc)`, index `(ip, created_at)` |
| `private.rate_limit_events` | `bucket`, `key`, `created_at`; index `(bucket, key, created_at)`; function `private.hit_rate_limit(bucket, key, max, window) returns boolean`; purged nightly |
| `message_logs` | As built in Phase 7: an outbox with **no content**: references (`order_id`, `status_history_id`, `kyc_submission_id`), `template_name`, `language`, `status`, `attempts`/`max_attempts`, `next_retry_at`, `locked_until`, `error_code` (code format only), delivery timestamps, `needs_attention`/`handled_by`, `pricing_category`, `billable`, `cost_usd`, `cost_source`. `private.message_events`: one row per (wamid, status). `whatsapp_rates`: USD per category. See decisions.md 2026-09-28 |
| `audit_logs` | `id bigint identity`, `actor_id`, `action` (`order.status_changed`, `kyc.reviewed`, `kyc.document_viewed`, `variant.price_changed`, `admin.permission_granted`, `invoice.issued`, …), `entity_type`, `entity_id`, `old_data jsonb`, `new_data jsonb`, `created_at`; indexes `(entity_type, entity_id)`, `(actor_id, created_at desc)`, `(created_at desc)`. Written **only by triggers/definer functions**. `REVOKE update, delete, truncate` from `anon, authenticated, service_role`, plus a `BEFORE UPDATE OR DELETE` trigger that raises (so service_role is blocked too). Limitation: the Postgres superuser can still alter it. Optional later: a `prev_hash` chain for tamper evidence |

### Storage buckets
| Bucket | Access | Path |
|---|---|---|
| `kyc-documents` | private; **no customer insert/select**; admin select only with `kyc` permission (needed to sign URLs); writes only from the server ingest pipeline | `{user_id}/{submission_id}.jpg` |
| `payment-receipts` | private; owner select own folder, admins with `orders`; writes only from the ingest pipeline | `{user_id}/{order_id}/{receipt_id}.jpg` |
| `public-assets` | public read; write only for `products`/`settings` admins | product/category images, banner, logo |

---

## D. Auth & authorization

### Authentication
- **Supabase Auth holds identities and sessions. OTP generation, verification and limits are ours** (`private.otp_codes`), because spec/CLAUDE.md require hashed codes, max attempts, per-phone cooldown, IP limits and a budget cap, which Supabase's built-in phone OTP doesn't fully expose.
- Account creation after OTP: `auth.admin.createUser({ phone, password, phone_confirm: true })` (service_role, server-only). Then `signInWithPassword({ phone, password })` sets the session cookie.
- **Attack surface to close (Phase 3 spike, must pass before merge):** the public `auth.signUp` endpoint is reachable with the anon key. Required outcome: *calling `signUp` directly with the anon key creates no usable account and sends no message.* Plan: enable the phone provider with **no SMS sender configured**, require phone confirmation, and add a `before-user-created` auth hook that rejects phone signups not originating from our flow. Fallback if the phone provider forces an SMS sender: store a synthetic login email (`<e164>@phone.invalid`) and disable the phone provider entirely. An automated test covers this.
- **Google OAuth:** callback → if the profile has no verified phone → `/account/verify-phone` (OTP `link_phone`). If that phone already belongs to another account → **never auto-merge.** Tell the user to sign in with phone + password and use *Account → Link Google* (`linkIdentity`, manual linking enabled). `create_order` refuses users without `phone_verified_at`.
- **Admins:** same login plus **TOTP MFA (Supabase Auth MFA, free)**, enforced in the database (see below).
- Passwords: min 10 chars. Enable Supabase leaked-password protection (Pro plan).

### Authorization: SQL helpers (in `private`, `STABLE SECURITY DEFINER`, `set search_path = ''`)
```sql
private.is_admin()               -- active row in admins for auth.uid() AND (auth.jwt()->>'aal') = 'aal2'
private.is_owner()               -- is_admin() AND is_owner
private.has_permission(p)        -- is_owner() OR exists(admin_permissions …)
```
Policies call `(select auth.uid())` / `(select private.has_permission('orders'))` (wrapped in `select` so Postgres evaluates once per statement, not per row). Every `user_id` column is indexed.

The **`aal2` check inside `is_admin()`** means a stolen admin password without the TOTP gives zero admin data access, even through PostgREST directly.

### RLS matrix (S=select I=insert U=update D=delete; "fn" = only via definer function)
| Table | anon | customer | admin (with permission) |
|---|---|---|---|
| categories/products/variants | S active only | S active only | S all; I/U/D `products` |
| faqs, bank_accounts | S published/active | same | I/U/D `settings` |
| app_settings | S via `public_settings` view (safe columns only) | same | S/U `settings` |
| profiles | — | S/U own (column grants) | S `customers` or `kyc` or `orders`; `is_blocked` U `customers` |
| kyc_submissions | — | S own; I fn `submit_kyc` | S `kyc`; review fn `review_kyc` |
| orders | — | S own; I fn `create_order` | S `orders`; status fn `change_order_status` |
| order_status_history | — | S own orders | S `orders` (written by fn) |
| order_internal_notes | — | **none** | S/I `orders` |
| payment_receipts | — | S own; I via ingest | S `orders`; review fn `review_receipt` |
| invoices | — | S own orders, `status='issued'` | S `invoices`; fn `issue_invoice` / `void_invoice` |
| comments | S visible | S visible; I own (verified phone); D own | S all; U/D `comments` |
| message_logs | — | — | S `orders` |
| admins, admin_permissions | — | — | owner only (S/I/U/D) |
| audit_logs | — | — | S owner only; never I/U/D |
| `private.*` | not exposed | not exposed | not exposed |

Every definer function re-checks the caller (`auth.uid()`, `has_permission`) internally. It never trusts that "only the admin UI calls this."

---

## E. Critical flows

### 1. Registration / OTP
1. `requestOtp(phone, purpose, turnstileToken)` server action:
   - Normalize to E.164 (`+249` + 9 digits, first digit 1 or 9; configurable country allowlist). Verify Turnstile.
   - Rate limits: per phone **60 s cooldown, 5/h, 10/day**; per IP **10/h**; **global daily budget** (`otp_daily_budget`). Hitting the budget stops sends and alerts the owner.
2. Invalidate previous active codes for (phone, purpose). Generate 6 digits with `crypto.randomInt` and store the HMAC only, expiring in 5 min.
3. `whatsapp.sendOtp(phone, code)` → Meta authentication template (copy-code button). The `message_logs` row holds no code. **Dev driver:** prints to the server console only when `NODE_ENV !== 'production'` **and** `WHATSAPP_DRIVER=dev`. Production boot fails if `WHATSAPP_DRIVER=dev`.
4. `verifyOtp(phone, purpose, code)`:
   - Atomic `update … set attempts = attempts+1 where … and attempts < max_attempts and consumed_at is null and expires_at > now() returning code_hash`.
   - Then `timingSafeEqual`. On success set `consumed_at`.
   - Per-IP verify limit of 30/h.
5. On success, issue a **verification ticket**: an httpOnly, signed, 10-min cookie bound to `(phone, purpose)`, single use.
6. `completeRegistration(ticket, full_name, password)` → `admin.createUser(…, phone_confirm: true)` → profile via trigger → `signInWithPassword` → redirect.
7. **Password reset:** same flow with `reset_password`. The response never reveals whether the phone exists. After verify: `admin.updateUserById(password)`, sign in, revoke other sessions.

### 2. KYC
1. Customer picks a document type and photo. The client resizes to ≤2000 px JPEG (~300–600 KB), which suits weak connections and also avoids Vercel's 4.5 MB body limit.
2. `submitKyc` server action:
   - Auth, then rate limit 3/day. No pending submission may exist.
   - Size ≤ 5 MB. Extension allowlist. **`sharp().metadata()` must report jpeg/png/webp** (magic bytes, not the client's MIME).
   - **Re-encode** with `sharp().rotate().resize(2400).jpeg()`, which drops EXIF/GPS and any appended payload. Compute sha256.
   - Upload to `kyc-documents/{uid}/{id}.jpg` (service_role, only here).
   - Call `submit_kyc()` → row `pending`, `profiles.kyc_status='pending'`.
3. Admin queue (`kyc` permission, aal2):
   - Opening a submission → server creates a **60 s signed URL** with the admin's own session (storage policy checks `has_permission('kyc')`) and writes `kyc.document_viewed` to the audit log.
   - Render with plain `<img>`, **never `next/image`**, which would copy the document into Vercel's image cache.
4. `review_kyc(id, decision, reason)`:
   - Updates the submission and `profiles.kyc_status`. Audit via trigger.
   - After commit: WhatsApp `kyc_result`. Retention purge per G3 (DB first, then storage delete; a nightly job retries orphaned deletes).

### 3. Order creation (as built, Phase 5)
1. The product page (static, ISR) renders the variant's fields and the database's totals per quantity (`price_sdg_totals`).
2. `placeOrder` server action: validate fields against the anon-visible variant (same rules as SQL), require a complete account, then RPC with the customer's session. Sends the total shown as `expected_total_sdg` (consent, not input) plus a client idempotency key.
3. `create_order()` (definer, one transaction):
   - `auth.uid()` required; same idempotency key → the existing order.
   - Quantity 1–10; 10 orders/hour per customer.
   - Live total from the DB; if it differs from the expected total → `price_changed` with the current total, nothing created.
   - Insert: the BEFORE INSERT trigger checks visibility, blocked/phone-verified, `quantity ≤ max_quantity`, fulfillment fields, derives the snapshot, enforces KYC (`total_usd ≥ kyc_threshold_usd` and not verified → `KYC_REQUIRED`) and generates the reference.
   - Snapshot total ≠ expected → rolled back as `price_changed` (rate changed mid-flight).
   - Audited (`orders.insert`, actor = customer).
4. Order page (`/account/orders/{reference}`, own orders only) shows the active bank accounts and a receipt upload.
   - `submitReceipt`: re-encode (EXIF stripped), service-role upload with `sha256` in object metadata, then `submit_receipt()` with the customer's session: own order in `new`, one pending receipt, active bank, transaction number format, path in the customer's folder, hash read from storage.
   - Duplicate `transaction_ref_norm` for that bank, or the same file hash, among non-rejected receipts → refused (friendly check + unique indexes).
   - `review_receipt()` (`orders` permission, not own order): accept → order moves to `processing`; reject needs a reason.

### 4. Status change
1. Admin (`orders`, aal2) → `changeOrderStatus(orderId, to, customerNote?)` → `change_order_status()`:
   - `select … for update` on the order.
   - Check `has_permission('orders')`.
   - Transition must exist in `order_status_transitions`.
   - **Guard:** `→ processing` requires an `accepted` receipt; `→ completed` requires `processing`.
   - Update and insert `order_status_history`. Audit trigger. Set `completed_at`/`cancelled_at`. Increment `products.completed_orders_count` on completion.
2. As built (Phase 7): if the status has `notify_customer`, a trigger on `order_status_history` queues a `message_logs` row in the same transaction (references only). Status changes never wait for or fail because of WhatsApp.
3. The server sends it right after the response (`after()`), rendering the template from the source records; failures are retried after 1, 5 and 30 minutes by `/api/whatsapp/dispatch`, called every minute by `pg_cron → pg_net` while something is due (bearer secret from Vault). After the 4th failure the row is `failed` + `needs_attention` and shows in the dashboard (follow-up list, card, order page, banner) with the customer phone for manual contact. OTP messages are never retried.
4. `/api/whatsapp/webhook`: GET verify-token handshake. POST **`X-Hub-Signature-256` HMAC verified** over the raw body with the app secret, then each (wamid, status) applied once; statuses only move forward; Meta's pricing fixes the cost.

### 5. Invoice (as built, Phase 8)
1. Completing an order issues its invoice **in the same transaction** (`orders_issue_invoice` trigger → `invoices` BEFORE INSERT):
   - Lock the order; only `completed` orders; one issued invoice per order (partial unique index).
   - Next number from the `private.invoice_counters` row for the current Khartoum year → `INV-2026-00001`. The row lock serialises concurrent completions; a rolled-back completion gives its number back (gapless).
   - `snapshot` = seller (business name, contacts, address), customer (name, phone), order lines and money, accepted payment. Totals copied from the order snapshot. Audited.
2. Invoices are immutable. A correction = `void_invoice(id, reason)` + `reissue_invoice(order_id)` (new number, snapshot taken again), `invoices` permission, audited; never an edit or delete.
3. Views (rendered only from the snapshot):
   - `/[locale]/account/invoices` and `/[locale]/account/invoices/[number]`: the caller's own issued invoices (RLS + explicit owner filter).
   - `/[locale]/admin/invoices` (search by number, order reference, customer name or phone, status, dates) and `/[locale]/admin/invoices/[number]` (void / re-issue).
   - Search: `search_invoices()`, SECURITY INVOKER, so RLS decides what each caller sees.
   - PDF = the browser's print ("Save as PDF") of the invoice page; print CSS removes the site around it (decisions.md 2026-09-29).

---

## F. Risks, ambiguities, client dependencies

**Blocking / high**
1. **Currency** (section 0). Blocks Phase 2 migrations.
2. **Meta WhatsApp for a Sudanese business.** Business verification, a dedicated number and template approval can take days to weeks, and may need documents Fares doesn't have ready. **Start now**, in parallel with Phase 1. The dev driver keeps us unblocked, but launch is not.
3. **Paying for services from Sudan.** Meta, Vercel and Supabase need an international card. Who pays, and with what card? This must be solved before launch, not in Phase 10.
4. **Hosting tier.** Vercel Hobby is **non-commercial only**, so this needs **Pro (~$20/mo)**. Supabase Free **pauses inactive projects and has no backups**, so production needs **Pro (~$25/mo)**. Fares must accept roughly **$45/mo + WhatsApp usage**. Suggestion: develop on free tiers, upgrade at launch.
5. **Reachability from Sudan.** Verify early that Vercel, Supabase and Google sign-in load on Zain/MTN/Sudani. Deploy a hello page in Phase 1 and have Fares test it on his phone.

**Medium**
6. **Receipt fraud.** Edited screenshots are trivial to make, so the system can't verify a transfer. Mitigation: mandatory transaction number, duplicate blocking, image-hash flag, and an admin UI that asks "confirmed in bank app?" before accept. Residual risk stays with the admin.
7. **Sensitive fulfillment data.** If any subscription variant needs the customer's account **password**, we are storing third-party credentials. Proposal: a `sensitive: true` field flag → masked in the UI, excluded from logs, and **purged from `fulfillment_data` when the order reaches a terminal state**. Ask Fares if any product needs this.
8. **OTP budget abuse.** Mitigated by limits, country allowlist, Turnstile and a daily cap. Turnstile adds a Cloudflare script; recommended.
9. **Timeline.** 45 days for 10 phases, solo. Rough budget: P1 2d, P2 5d, P3 6d, P4 4d, P5 5d, P6 7d, P7 4d, P8 3d, P9 3d, P10 5d, with ~1 day of slack. Any scope addition must displace something.
10. **Frequent repricing.** With option A, Fares re-prices by hand as SDG moves. A bulk "adjust all prices by x%" tool is not in the spec. Flag it to the client.

**Ambiguities (my default in brackets)**
- Diaspora customers with non-+249 phones? [+249 only; allowlist configurable]
- Unpaid `new` orders expire automatically? [no; admin cancels]
- Customer self-cancel? [no in MVP]
- Comments: any verified customer, or only buyers? Pre- or post-moderation? [any verified customer, post-moderation]
- Invoice language? [one bilingual AR/EN layout]
- Initial KYC threshold? [must be set before launch; until then the seed uses a dev value, and production refuses orders if it is null]

**Pending from client:** currency answers, logo/brand assets, bilingual product content, policy texts, KYC threshold, domain, Meta Business account + dedicated WhatsApp number, payment card for services, confirmation of any legal retention duty for IDs.

---

## G. Recommended defaults for spec §12

| # | Decision | Recommendation | Reasoning |
|---|---|---|---|
| 1 | Currency | Customer always pays **SDG**. **Option B** (USD base + owner-set rate, snapshotted per order) if Fares's costs are USD, else A | Receiving accounts are SDG-only. B avoids manual re-pricing under inflation. The schema supports both with nullable fx columns |
| 2 | OTP policy | OTP on **register, password reset, phone link/change**. **No OTP on login.** Admins use **TOTP** instead | Cost + friction. Login OTP adds nothing that a strong password + rate limit doesn't for customers. If later required, use Supabase MFA phone factor (proper `aal2`), not a custom half-session |
| 3 | ID retention | **Delete the file on approval** (after commit). Rejected files are deleted on resubmission or after 30 days. Keep the verdict, reviewer, timestamp, doc type, sha256 | Minimises what a breach can leak. The hash proves which file was reviewed without keeping it. **Ask Fares** whether a bank/regulator requires retention; if so, switch to a fixed window with a nightly purge |
| 4 | Arabic PDF | **HTML invoice + print CSS + self-hosted Arabic font (`next/font`)**. "PDF export" = the browser's Save as PDF. If a one-click file is required (e.g. sending the PDF over WhatsApp), add **server-side headless Chromium** as an isolated route. Do a spike in Phase 8 | The browser's text engine shapes Arabic and bidi correctly. `@react-pdf`, `pdfmake` and `jsPDF` have a history of broken Arabic shaping/bidi. Chromium on Vercel is heavy (cold starts, size), so add it only when needed |
| 5 | Receipts | **Image + mandatory transaction number + chosen bank**. Hard unique per bank on the normalised number; image-hash duplicates flagged | Cheap and catches the most common fraud (reusing a receipt). The number also speeds up the admin's bank-app lookup |
| 6 | Admin 2FA | **Day one**, TOTP via Supabase MFA, enforced in RLS via `aal2` | Free, about 1 day of work. Admins can read IDs and move money states. Retrofitting later means re-testing every policy |
| 7 | Order reference | **`FD-` + 7 random digits** (e.g. `FD-4827193`), unique with retry; internal PK is a uuid. Invoices get the sequential number | Digits only: easy to read over WhatsApp and for Arabic speakers. Random: doesn't leak sales volume or invite guessing. 10⁷ space; collisions retried |

---

## H. Folder structure

```
/
├── CLAUDE.md
├── docs/                      spec, roadmap, decisions, architecture
├── messages/                  ar.json, en.json
├── content/                   policy pages: {slug}.{ar,en}.mdx
├── public/                    static assets, fonts if not via next/font
├── supabase/
│   ├── config.toml
│   ├── migrations/            timestamped SQL: schema, RLS, functions, triggers, storage policies
│   ├── seed.sql               dev-only seed (never run against prod)
│   └── tests/                 pgTAP: rls_*.test.sql, orders_*.test.sql …
├── scripts/                   bootstrap-owner.ts (one-off, documented), purge jobs if needed
├── src/
│   ├── app/
│   │   ├── [locale]/
│   │   │   ├── (public)/      page.tsx, c/[slug], p/[slug], search, faq, pages/[slug]
│   │   │   ├── (auth)/        login, register, verify, reset-password
│   │   │   ├── account/       profile, kyc, orders, orders/[ref], orders/[ref]/invoice
│   │   │   └── admin/         orders, catalog, customers, kyc, invoices, comments, faqs,
│   │   │                      settings, admins, audit, messages
│   │   ├── api/
│   │   │   ├── whatsapp/webhook/route.ts
│   │   │   └── whatsapp/dispatch/route.ts   (pg_cron → pg_net, Phase 7)
│   │   ├── auth/callback/route.ts
│   │   ├── sitemap.ts, robots.ts
│   ├── components/
│   │   ├── ui/                shadcn
│   │   └── layout/, catalog/, orders/, admin/, forms/
│   ├── server/                server-only domain code (actions + queries per feature)
│   │   ├── auth/              otp.ts, tickets.ts, actions.ts, guards.ts (requireUser, requirePermission)
│   │   ├── kyc/  orders/  catalog/  invoices/  comments/  settings/  admins/
│   │   ├── files/             ingest.ts (validate + sharp re-encode + hash + upload)
│   │   ├── notifications/     orderStatusChanged, kycResult
│   │   └── whatsapp/          types.ts (interface), meta-driver.ts, dev-driver.ts, templates.ts
│   ├── lib/
│   │   ├── supabase/          server.ts, browser.ts, admin.ts (server-only), middleware.ts
│   │   ├── validation/        shared Zod schemas, required-fields → Zod builder
│   │   ├── env.ts             Zod-validated env; fails boot on missing/unsafe config
│   │   ├── phone.ts, money.ts, dates.ts
│   ├── i18n/                  routing.ts, request.ts, navigation.ts
│   └── middleware.ts          next-intl + Supabase session refresh (proxy.ts on Next 16)
├── tests/                     vitest: otp, pricing, required-fields, phone, ingest
├── .env.example
└── vercel.json                cron schedule
```

---

## I. Implementation order

Same as the roadmap, with three adjustments:

1. **Now, outside the code:** Fares answers currency. Start the Meta Business verification and WhatsApp number setup. Settle who pays for hosting and with which card.
2. **Phase 1, Foundation:** plus a deployed hello page tested from Sudanese networks, and `env.ts` validation.
3. **Phase 2, DB & security:** migrations in this order: enums/lookup → identity/admin + helpers → catalog → orders/payments → invoices/counters → content/settings → messaging/audit → storage buckets/policies → audit triggers. pgTAP suite for isolation + admin boundaries + `aal2`. `bootstrap-owner` script.
4. **Phase 3, Auth & KYC:** ⚠ **move the WhatsApp interface + dev driver here** (OTP needs them); the Meta driver stays in Phase 7. Includes the `signUp`-bypass spike and test, admin TOTP enrolment, and the file ingest pipeline (reused by receipts).
5. **Phase 4, Catalog:** as planned, plus the Arabic search normalisation.
6. **Phase 5, Orders & payments:** as planned. Tests: price tampering (direct RPC with a forged body), KYC bypass via direct RPC, invalid transitions, duplicate receipts, idempotency.
7. **Phase 6, Admin.**
8. **Phase 7, WhatsApp Meta driver, webhook, retries.** Templates should already be submitted since step 1.
9. **Phase 8, Invoices** (PDF spike first).
10. **Phase 9, UX/SEO/perf.**
11. **Phase 10, QA & deploy.** Include a manual pass through the RLS matrix using PostgREST directly with a customer JWT.

**On approval I will:** record decisions 1–7 plus the architecture principles in `docs/decisions.md`, and apply any changes you request here before Phase 1.

## Admin dashboard (as built, Phase 6)
- `/[locale]/admin/*`, one section per permission: Orders (`orders`), Products (`products`), Customers (`customers`), Identity checks (`kyc`), Comments (`comments`), FAQs + Settings (`settings`), Admins + Audit log (owner only). Non-admins and admins without the permission get 404.
- Server code: `src/server/admin/*` — `*-queries.ts` (reads, admin session), `orders.ts`, `catalog.ts`, `people.ts`, `settings.ts` (Server Actions; first line is the permission check; `ActionResult` = `{ok}` or `{ok:false,error}`). Public images via `public-images.ts` (admin session, path-confined storage policy).
- UI: `ActionForm` (client) posts any form to its action through `onSubmit`, keeps typed values on errors, shows the localized result and refreshes the page on success. It is disabled until hydration.
- Database additions: `admin_orders()` (orders search, invoker + permission check), `admin_comments()`, `set_customer_blocked()`, `product_comments()` (public), limits in `security_settings`, `can_write_public_asset()`.

