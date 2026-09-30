# Production launch runbook

From staging to the client's own production: a new Supabase project and a new
Vercel project, both owned by the client (Fares), deployed from `main`. Each
step says who does it: **C** = client (account owner), **D** = developer.
Never copy data from staging: production starts from migrations only.

## 0. What the client must provide

| # | Item | Who | Blocks launch? | Notes |
|---|---|---|---|---|
| 1 | International payment card for the three services | C | **Yes** | Vercel Pro (~$20/mo; Hobby is non-commercial only), Supabase Pro (~$25/mo; Free pauses and has no backups), Meta (per message). |
| 2 | Supabase organisation owned by the client, developer invited as member | C | **Yes** | Project created in it (step 2). |
| 3 | Vercel team owned by the client (Pro), developer invited | C | **Yes** | GitHub access to this repository for the Vercel app. |
| 4 | Domain name and DNS access | C | **Yes** | Without it the site can only run on `*.vercel.app`, which is never indexed (by design) and looks untrustworthy. |
| 5 | Meta Business account, verified business, WhatsApp number not used on the WhatsApp app | C | **Yes** | Without it no verification code can be sent, so nobody can register or reset a password. |
| 6 | WhatsApp templates approved by Meta (ar + en) | C submits, D prepares | **Yes** | Texts in `docs/whatsapp-templates.md`; approval takes hours to days. |
| 7 | Sudan per-message rates (Utility, Authentication) | C (from Meta's rate card) | No | Costs show "no cost yet" until entered. |
| 8 | Google Cloud project + OAuth client | C (D can guide) | No | The Google button stays hidden until configured (step 7). |
| 9 | Logo (PNG/WebP) | C | No | A text wordmark is shown until uploaded (Settings). |
| 10 | Real catalog: categories, products, packages, prices, images | C (entered in the dashboard) | **Yes** (nothing to sell) | Entered by staff after launch setup, before opening. |
| 11 | Exchange rate and KYC threshold | C | **Yes** | Orders are refused until both are set (Settings). |
| 12 | Confirm the three bank accounts and the Arabic branch names | C | **Yes** | Created by migration from the spec; branch names were translated by us. |
| 13 | Business name (ar/en), contacts, address, social links | C | No (invoices print the business name: set before the first sale) | Settings. |
| 14 | About, Terms and Privacy texts (the terms should cover refunds) | C writes, staff enter them in *Pages* | **Yes** (signed scope) | The pages are built and editable (Phase 10b); each stays hidden until its text is published. |
| 15 | Owner registers on the live site with their phone | C | **Yes** | Then D runs the owner bootstrap (step 8). |
| 16 | An authenticator app on every staff phone (Google or Microsoft Authenticator), and a second phone for the owner's backup | C | **Yes** | The dashboard opens only with a code (Phase 10b). |

## 1. Code (D)

- Production deploys from **`main`** only. Work continues on feature branches;
  a release is a merge into `main` after `npm run check` and the full test run.
- GitHub (C or D with admin rights): set `main` as the default branch and
  protect it (no force-push, no deletion).
- `vercel.json` pins functions to **`fra1` (Frankfurt)** to sit next to the
  database. If the Supabase project is created in another region, change it
  to the matching Vercel region; a mismatch adds a cross-continent round trip
  to every database call (staging measured this: functions in `iad1`,
  database in Frankfurt).

## 2. Supabase project (C creates, D configures)

1. C: new project in the client's organisation, **Pro** plan, region
   **Central EU (Frankfurt, eu-central-1)**, strong database password kept in
   the client's password manager (D never needs to store it).
2. D, from a clean checkout of `main`:
   ```sh
   npx supabase login                      # D's own access token, in the terminal only
   npx supabase link --project-ref <ref>   # asks for the database password
   npx supabase db push                    # migrations only
   npx supabase migration list             # local and remote columns identical
   ```
   Never `--include-seed`, never `supabase/seed.sql`, never
   `supabase/staging/demo-seed.sql`.
3. D: in the SQL editor, confirm the starting state (expected values in the
   comments):
   ```sql
   select (select count(*) from public.categories)       as categories,  -- 0
          (select count(*) from public.products)         as products,    -- 0
          (select count(*) from public.bank_accounts)    as banks,       -- 3 (from the spec)
          (select count(*) from auth.users)              as users,       -- 0
          (select usd_sdg_rate from public.app_settings) as rate,        -- null until set
          (select count(*) from pg_extension where extname = 'pg_graphql') as graphql; -- 0
   ```
4. D: Advisors → Security: expect only the items explained in
   `docs/security-review.md` (definer RPCs, deny-all private tables).

## 3. Auth settings (D, Supabase dashboard)

Authentication → Sign In / Providers:

| Setting | Value |
|---|---|
| Phone provider | **On**, no SMS provider credentials (the Send SMS hook handles it) |
| Email provider | **Off** |
| Anonymous sign-ins | **Off** |
| Manual linking | **On** (a Google user links their phone) |
| Minimum password length | **10** |
| Leaked password protection | **On** (Pro) |
| Multi-Factor → Authenticator app (TOTP) | **Enabled** (the default on hosted projects; staff cannot open the dashboard without it) |
| Allow new users to sign up | **On only if Google sign-in is enabled** (step 7); otherwise off. Registration by phone should not need it: the server creates the account through the admin API after the OTP, which this toggle does not govern. Not yet exercised with the toggle off (local runs keep it on; staging accounts were seeded); the owner's registration in step 8 is the check. If it is refused, turn it on: the hook and trigger keep every other path closed. |

**Recommended: lower the access-token (JWT) expiry to 900 s (15 min)**
(Project Settings → JWT Keys → access token expiry; older dashboards:
Settings → API → JWT expiry; the default is 3600 s, as in
`supabase/config.toml`).

- *Why.* A token already issued stays valid at the API until it expires,
  even after the owner resets a staff member's 2FA (the site signs them out
  at once; the database API accepts the old token until it expires). The
  same holds for a stolen token. Deactivating a staff member is not affected:
  the database checks `is_active` on every call. 15 minutes instead of an hour
  shortens that window by three quarters.
- *Cost.* The site renews the token four times as often: one extra request
  to Supabase Auth per signed-in visitor every 15 minutes (well inside the
  plan's limits at this scale), and on a weak connection a renewal can fail
  and cost one retry or, rarely, a fresh sign-in. Customers keep their long
  sign-in (the refresh token is unchanged); only the short token rotates.
- Accepted for now at 3600 s (decisions.md 2026-09-28); lower it before the
  client's staff start working. Do not go below 300 s.

Authentication → Hooks: *Send SMS* → Postgres `private.auth_hook_send_sms`;
*Before User Created* → Postgres `private.auth_hook_before_user_created`.

URL configuration: Site URL `https://<domain>`; Redirect URLs
`https://<domain>/auth/callback`.

Check that public sign-up is closed (safe: every call must be refused;
`<anon>` is the publishable key, which is public):
```sh
U=https://<ref>.supabase.co/auth/v1; K=<anon>
curl -s $U/signup -H "apikey: $K" -H 'content-type: application/json' -d '{"phone":"+249912345678","password":"Aa123456789!"}'
curl -s $U/signup -H "apikey: $K" -H 'content-type: application/json' -d '{}'                      # anonymous
curl -s $U/signup -H "apikey: $K" -H 'content-type: application/json' -d '{"email":"x@example.com","password":"Aa123456789!"}'
curl -s $U/otp    -H "apikey: $K" -H 'content-type: application/json' -d '{"phone":"+249912345678"}'
```
Each must return an error (`SIGNUP_NOT_ALLOWED`, "Anonymous sign-ins are
disabled", "Email signups are disabled", or the SMS hook refusal), and
`select count(*) from auth.users` must still be 0. Even if a toggle is wrong,
the `guard_auth_user_insert` trigger refuses any account the server did not
create after an OTP (acceptance test 1; checked the same way on staging).

## 4. Secrets (D generates, enters them directly in Vercel; never in chat or git)

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # OTP_HMAC_PEPPER
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # WHATSAPP_DISPATCH_SECRET
```
New values for production; never reuse staging's.

## 5. Vercel project (C creates, D configures)

1. Import this repository; framework Next.js; **Production Branch: `main`**.
2. Environment variables, **Production** scope (mark secrets *Sensitive*):

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_SITE_URL` | `https://<domain>` (no trailing slash) |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → API Keys → publishable |
   | `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` | `false` until step 7 |
   | `SUPABASE_SECRET_KEY` | Supabase → API Keys → secret (*Sensitive*) |
   | `OTP_HMAC_PEPPER` | step 4 (*Sensitive*) |
   | `WHATSAPP_DRIVER` | `meta` (the dev driver refuses to start on Vercel) |
   | `WHATSAPP_*` | step 6 |

   Preview deployments of the production project must not get the production
   secret key: leave Preview empty (staging is the preview environment).
3. Domains: add `<domain>` and `www.<domain>` (redirect www → apex), set the
   DNS records Vercel shows, wait for the certificate.
4. Deploy. Robots: the site is indexable only when `VERCEL_ENV=production` **and**
   the site URL is not `*.vercel.app` (`src/lib/seo.ts`).
5. Deployment Protection: off for the custom domain (public shop); Vercel
   Authentication may stay on for `*.vercel.app` URLs.

## 6. WhatsApp (C: Meta side; D: configuration)

1. Vercel variables (server only): `WHATSAPP_ACCESS_TOKEN` (System User
   permanent token), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`,
   `WHATSAPP_DISPATCH_SECRET` (step 4) and, only while subscribing the webhook,
   `WHATSAPP_VERIFY_TOKEN`.
2. Meta app → WhatsApp → Configuration: callback URL
   `https://<domain>/api/whatsapp/webhook`, the same verify token, subscribe to
   **messages**. When Meta shows it verified, delete `WHATSAPP_VERIFY_TOKEN`
   from Vercel and redeploy (Meta puts it in the URL, so it lands in logs).
3. Retry scheduler: in the Supabase SQL editor, once:
   ```sql
   select vault.create_secret('https://<domain>/api/whatsapp/dispatch', 'whatsapp_dispatch_url');
   select vault.create_secret('<WHATSAPP_DISPATCH_SECRET>', 'whatsapp_dispatch_secret');
   ```
   To change one: `select vault.update_secret(id, '<new>') from vault.secrets where name = '…';`.
   Without them, messages still go out right after each action; only retries
   of failed sends stop (and the dashboard banner says so).
4. Dashboard → WhatsApp messages → Rates: Sudan prices (USD).
5. Run the real-API checklist in `docs/whatsapp-templates.md` (17 points).
6. Token or app secret rotation: change the Vercel variable, redeploy.

## 7. Google sign-in (optional at launch)

1. C (Google Cloud Console, client's account): OAuth consent screen
   (external, app name, support email, domain), then an OAuth client of type
   *Web application* with authorised redirect URI
   `https://<ref>.supabase.co/auth/v1/callback` and JavaScript origin
   `https://<domain>`. Hand the client id and secret to D through the
   dashboard fields below, not through chat.
2. D: Supabase → Authentication → Providers → Google: on, paste id and secret;
   **Allow new users to sign up: On** (Google accounts are created as
   *incomplete*; the hook and trigger still refuse every other path; re-run
   the curl checks of step 3).
3. Vercel: `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`, redeploy.
4. Test once with a real Google account: sign in → *Complete your account*
   asks for the phone → OTP → account complete; before the OTP no page or API
   works for that account.

## 8. Owner account (C then D)

1. C registers on `https://<domain>/ar/register` with their own phone.
2. D, SQL editor:
   ```sql
   insert into public.admins (user_id, is_owner)
   select id, true from auth.users where phone = '2499XXXXXXXX';  -- without '+'
   ```
3. C signs in: *My account* shows the dashboard card. The first click on it
   opens *Set up two-step sign-in*: scan the QR code with an authenticator
   app, enter the code. Then, straight away, *Security → Add another
   authenticator* on a second phone (the owner's only way back in without
   the database).
4. The owner adds staff in *Admins* (each staff member first registers
   normally, then sets up their own authenticator at their first dashboard
   visit).
5. Owner lost every authenticator (break glass, whoever holds the Supabase
   account, after confirming it is really the owner):
   ```sql
   select private.break_glass_reset_mfa('2499XXXXXXXX');  -- the owner's phone
   ```
   It removes the owner's authenticators and signs them out everywhere
   (audited); the next sign-in sets up a new one. Staff who lose their phone
   ask the owner: *Admins → Reset two-step sign-in*.

## 9. Before opening (C, in the dashboard)

Settings: exchange rate, KYC threshold, business name (ar/en), contacts,
address, social links, logo, banner; confirm the bank accounts; review the
limits and the OTP daily budget. Catalog: categories, products, images,
packages. FAQs. *Pages*: About, Terms and Privacy texts in Arabic (and
English), then *Published*. Then one real order end to end with a small amount (register,
order, transfer, receipt, accept, complete, invoice, WhatsApp messages).

## 10. Demo accounts and seed data

Production never receives them (step 2). Proof, before opening, in the
production SQL editor (every count must be 0):
```sql
select (select count(*) from auth.users where phone like '2499000000%'
          or id::text like 'd_000000-0000-4000-8000-%')                       as demo_users,
       (select count(*) from public.categories where id::text like '00000000-0000-4000-%') as seed_categories,
       (select count(*) from public.products where id::text like '00000000-0000-4000-%')   as seed_products,
       (select count(*) from public.product_variants where id::text like '00000000-0000-4000-%') as seed_variants;
```
Staging keeps its demo data (it is the test environment). When staging is no
longer needed: delete the Supabase project `faris-digital-staging` and the
Vercel project `faris-digital-staging` from their dashboards; nothing else
refers to them.

## 11. Launch checks (D)

- `curl -sI https://<domain>/ar` shows `content-security-policy` with a nonce,
  `strict-transport-security`, `x-frame-options: DENY`.
- `https://<domain>/robots.txt` allows crawling and names the sitemap; submit
  the sitemap in Google Search Console (C's Google account).
- Lighthouse mobile on home, product and login.
- Real phones: invoice *Save as PDF* (Android Chrome, iPhone Safari); a full
  order on a Sudanese mobile network.

## 12. Backups

- **Automatic (Pro):** daily database backups, kept 7 days; restore from
  Supabase → Database → Backups (restores the whole database to that day).
  Storage files are not part of it.
- **Monthly manual export (D, or anyone with the database password):**
  ```sh
  npx supabase db dump --linked -f backup/roles.sql --role-only
  npx supabase db dump --linked -f backup/schema.sql
  npx supabase db dump --linked -f backup/data.sql --data-only
  npx supabase --experimental storage cp -r --linked ss:///payment-receipts backup/storage/
  npx supabase --experimental storage cp -r --linked ss:///public-assets   backup/storage/
  ```
  The `kyc-documents` bucket is **not** exported: identity documents are
  deleted after review and must not live in backups. Keep exports encrypted
  (they hold customer names and phones) in the client's storage, not the
  developer's. The dump also holds the staff authenticator secrets
  (`auth.mfa_factors`), one more reason to keep it encrypted. Vault secrets
  are not in the dump; re-create them (step 6.3) after a restore.
  Verified on the local stack: the three dumps cover `auth`, `public`,
  `private` and storage metadata; the file export copied 27 of 27 objects
  (20 receipts, 7 public images).
- **Restore drill:** create an empty project, then
  `psql --single-transaction -v ON_ERROR_STOP=1 -f roles.sql -f schema.sql -c 'set session_replication_role = replica' -f data.sql "<new db url>"`,
  upload the storage folders, re-create the Vault secrets, point a Vercel
  preview at it. Do this once before launch so the procedure is known to work
  on hosted Supabase.

## 13. Rollback

- Code: Vercel → Deployments → previous production deployment → *Instant
  Rollback*.
- Database: migrations are forward-only; fix forward with a new migration. Data
  loss or corruption: restore a daily backup (loses changes since) or PITR if
  enabled.

## 14. Client IP and hosting

Per-IP limits trust `x-real-ip` / `x-forwarded-for`, which Vercel sets and
clients cannot forge. Hosting anywhere else needs a reverse proxy that
overwrites these headers, or the per-IP limits can be bypassed.

## Appendix: staging (faris-digital-staging)

A hosted copy for review with demo data only. It never holds real customers.

- **Supabase:** project `faris-digital-staging` (ref `iojsknoiyewndldggwfo`, free tier).
  All migrations in `supabase/migrations/` are applied (history versions match the
  file names), then `supabase/seed.sql`, then `supabase/staging/demo-seed.sql`.
- **Vercel:** project `faris-digital-staging`, linked to this repository. Every push
  to the branch deploys; `*.vercel.app` URLs are behind Vercel Authentication
  (team members only).
- **WhatsApp:** `WHATSAPP_DRIVER=meta` with no Meta credentials, so every send
  fails and is shown as failed (OTP screens say the code could not be sent).
  The production guard is unchanged: the dev driver refuses to start on Vercel.
- **Expected red banner on staging: "27 messages are waiting longer than
  expected".** The demo data was created with SQL, so the send that normally
  follows each staff action never ran, and the retry scheduler has no Vault
  secrets on staging, so nothing ever picks the messages up. They stay
  *Waiting to send* forever and the banner stays. This is not a fault and needs
  no action. In production the same banner means the scheduler is not running
  (step 6.3 above).
  Do **not** connect real Meta credentials or the scheduler to staging while
  those demo messages exist: they are addressed to the demo numbers
  (+2499000000xx), which could belong to real people.
  - بالعربية: الشريط الأحمر في staging («27 رسالة تنتظر أكثر من المتوقع») متوقع: البيانات التجريبية أُدخلت بـ SQL، وخدمة إعادة الإرسال غير مفعّلة هناك، وواتساب غير موصول. لا يحتاج أي إجراء. لا توصل بيانات Meta الحقيقية بـ staging لأن الرسائل موجهة لأرقام تجريبية قد تكون لأشخاص حقيقيين.
- **Two-step sign-in on staging:** since Phase 10b the demo owner and the
  demo orders staff are asked to set up an authenticator at their next
  dashboard visit (any authenticator app works; the account label is
  `2499000000xx@staff.invalid`). The demo customer is not affected.
- **Demo accounts:** owner, orders-only staff and one customer sign in with phone
  + password (`+249900000001/2/3`). Passwords are never in the repository;
  `demo-seed.sql` takes their bcrypt hashes as psql variables. Other demo
  customers have no password.
- **Not seeded:** receipt and identity-document images (Storage is written only
  by the app). Review screens show "no image" for demo rows.

Settings that live only in the dashboards (not in migrations):
1. Vercel → Project → Settings → Environment Variables: `SUPABASE_SECRET_KEY`
   (Supabase → Project Settings → API Keys → secret key), type *Sensitive*,
   Production + Preview. Then redeploy.
2. Supabase → Authentication → Sign In / Providers: Phone **on**; Email **off**;
   "Allow new users to sign up" **off** (Google is not configured on staging;
   see step 3 for production); minimum password length 10.
3. Supabase → Authentication → Hooks: *Send SMS* → Postgres
   `private.auth_hook_send_sms`; *Before User Created* → Postgres
   `private.auth_hook_before_user_created`.

Public sign-up is closed even if (2) is misconfigured: the deferred
`guard_auth_user_insert` trigger rejects any new `auth.users` row without the
server's OTP marker at commit (checked on staging: phone, anonymous and email
sign-ups → `SIGNUP_NOT_ALLOWED`).
