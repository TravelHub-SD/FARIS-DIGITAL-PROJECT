# Handover guide

Operational notes for whoever runs Faris Digital after delivery. Grows phase by
phase; completed in Phase 10 together with the Arabic user guide.

## Product, banner and logo images

Images are **not** resized by an image service at request time (that costs
money on the hosting free tier). Staff prepare them before uploading; the
dashboard then re-encodes each upload to WebP at fixed sizes and removes all
metadata.

| Image | Format | File size | Dimensions (original) | Ideal |
|---|---|---|---|---|
| Product | JPG, PNG or WebP | up to 2 MB | 300–4000 px on the longest side; not wider/taller than 3:1 | 1200 × 900 |
| Banner | JPG, PNG or WebP | up to 2 MB | at least 800 × 200, at most 6000 px wide; between 1.5:1 and 6:1 | 1600 × 400 |
| Logo | PNG (transparent) or WebP | up to 2 MB | 64–2000 px | 512 px wide |

Files outside these limits are refused with a message saying why; a file over
2 MB is refused in the browser before it is uploaded. Phone camera photos
(4000+ px, 3–8 MB) must be resized first (any photo editor, or
<https://squoosh.app>).

### بالعربية (لطاقم العمل)

- صغّر الصورة **قبل** رفعها: حتى 2 ميجابايت، وأطول ضلع لا يزيد عن 4000 بكسل للمنتج (المقاس المثالي 1200×900).
- صور الكاميرا مباشرة ترفض لأنها كبيرة؛ صغّرها أولاً بأي برنامج تعديل صور أو بموقع squoosh.app.
- البانر صورة عريضة (المثالي 1600×400)، والشعار PNG بخلفية شفافة (المثالي عرض 512 بكسل).
- اللوحة تعيد ترميز كل صورة وتحذف بياناتها الوصفية (مثل موقع التصوير) تلقائياً.

## WhatsApp (Meta Cloud API)

Templates and the real-API checklist: `docs/whatsapp-templates.md`.

### Setup (once per environment)

1. Vercel environment variables (server only, never `NEXT_PUBLIC_`):
   `WHATSAPP_DRIVER=meta`, `WHATSAPP_ACCESS_TOKEN` (a System User permanent
   token), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`,
   `WHATSAPP_DISPATCH_SECRET` (64 random hex characters) and, only while
   subscribing the webhook, `WHATSAPP_VERIFY_TOKEN`.
2. Meta app → WhatsApp → Configuration: callback URL
   `https://<domain>/api/whatsapp/webhook`, the same verify token, subscribe
   to **messages**. Once Meta shows the webhook as verified, delete
   `WHATSAPP_VERIFY_TOKEN` from Vercel and redeploy (Meta puts that token in the
   URL, so it ends up in request logs; it is not needed afterwards).
3. Retry scheduler: the database calls the site every minute while something
   is due. In the Supabase SQL editor, once:
   ```sql
   select vault.create_secret('https://<domain>/api/whatsapp/dispatch', 'whatsapp_dispatch_url');
   select vault.create_secret('<the WHATSAPP_DISPATCH_SECRET value>', 'whatsapp_dispatch_secret');
   ```
   To change one later: `select vault.update_secret(id, '<new value>') from vault.secrets where name = '…';`
   Without these secrets, messages are still sent right after the action that
   caused them; only the retries of failed sends stop (and the dashboard
   reports "waiting longer than expected").
4. Dashboard → WhatsApp messages → Rates: enter Meta's per-message price for
   Sudan (USD) for Utility and Authentication. Until then costs show as
   "no cost yet".

Rotating the access token or the app secret: change the Vercel variable and
redeploy; nothing is stored in the database.

### What staff see and do

- Each failed notification is tried 4 times (after 1, 5 and 30 minutes). If it
  still fails it appears under **WhatsApp messages → Needs follow-up**, on the
  dashboard card and on the order page.
- A red banner on every admin page means sending is failing right now (Meta
  down, token expired, template not approved) or retries are stuck.
- For each message: **Contact on WhatsApp** opens a chat with the customer;
  **Try again** sends it once more (after the problem is fixed); **Mark as
  handled** when the customer was informed another way. Both are recorded in
  the audit log.
- Verification codes are never retried (a new code is requested instead) and
  are not listed for follow-up one by one; many failures show in the banner.
- Message texts are not stored anywhere in the dashboard, by design; the list
  shows the type, status, attempts, error and cost.

### بالعربية (لطاقم العمل)

- كل إشعار يفشل يُعاد إرساله تلقائياً حتى 4 مرات (بعد دقيقة، ثم 5 دقائق، ثم 30 دقيقة).
- إذا فشل بعد ذلك يظهر في **رسائل واتساب ← تحتاج متابعة**، وفي بطاقة لوحة التحكم، وفي صفحة الطلب.
- الشريط الأحمر أعلى صفحات الإدارة يعني أن الإرسال متوقف الآن (مشكلة لدى Meta أو في الإعداد) أو أن إعادة المحاولة متأخرة.
- **تواصل عبر واتساب** يفتح محادثة مع العميل، و**إعادة المحاولة** ترسل الرسالة مرة أخرى بعد حل المشكلة، و**تمت المتابعة** عندما يُبلَّغ العميل بطريقة أخرى. كل ذلك يُسجَّل في سجل التدقيق.
- رموز التحقق لا يعاد إرسالها تلقائياً؛ العميل يطلب رمزاً جديداً.
- نص الرسائل لا يُحفظ في اللوحة عمداً؛ تظهر فقط الحالة والمحاولات والخطأ والتكلفة.

## Invoices

- An invoice is issued automatically when an order is marked **completed**. Numbers
  run `INV-2026-00001`, `INV-2026-00002`, … per year with no gaps.
- An issued invoice never changes. To correct one (for example a misspelled
  customer name): fix the cause, open the invoice, **Void invoice** with a reason,
  then **Issue new invoice**. The new one gets the next number; the old one stays
  visible to staff marked VOID. Customers only see the valid one.
- The business name printed on new invoices is in *Settings → Business name*.
  Invoices already issued keep the name they were issued with.
- PDF: open the invoice → **Print / Save as PDF** → choose "Save as PDF" as the
  printer. The button opens the phone's print screen too; on an iPhone the PDF is
  saved from the share button of the print preview. (Phone steps to be confirmed
  on real devices in Phase 10.)

### بالعربية (لطاقم العمل)

- تصدر الفاتورة تلقائياً عند تحويل الطلب إلى **مكتمل**، بأرقام متسلسلة بلا فجوات لكل سنة.
- الفاتورة الصادرة لا تتغير. للتصحيح (مثل خطأ في اسم العميل): صحّح السبب، ثم افتح الفاتورة واضغط **إلغاء الفاتورة** مع ذكر السبب، ثم **إصدار فاتورة جديدة**. تبقى الملغاة ظاهرة للطاقم فقط.
- الاسم التجاري المطبوع على الفواتير الجديدة في *الإعدادات*.
- لحفظ PDF: افتح الفاتورة ← **طباعة / حفظ PDF** ← اختر «حفظ بتنسيق PDF».

## KYC documents awaiting deletion

Identity documents are deleted right after the review. If that deletion fails
(storage unavailable), the document appears on the KYC page under **Documents
awaiting deletion**; press **Delete file**. After 24 hours a red banner appears on
every admin page for KYC staff until it is done.
- بالعربية: إذا ظهر مستند تحت «مستندات بانتظار الحذف» في صفحة التحقق من الهوية فاضغط **حذف الملف**. بعد 24 ساعة يظهر شريط أحمر في كل صفحات الإدارة حتى يُحذف.

## Staging (faris-digital-staging)

A hosted copy for review with demo data only. It never holds real customers.

- **Supabase:** project `faris-digital-staging` (ref `iojsknoiyewndldggwfo`, free tier).
  All migrations in `supabase/migrations/` are applied (history versions match the
  file names), then `supabase/seed.sql`, then `supabase/staging/demo-seed.sql`.
- **Vercel:** project `faris-digital-staging`, linked to this repository. Every push
  to the branch deploys; `*.vercel.app` URLs are behind Vercel Authentication
  (team members only).
- **WhatsApp:** `WHATSAPP_DRIVER=meta` with no Meta credentials, so every send
  fails and is shown as failed (OTP screens say the code could not be sent;
  admin pages show the WhatsApp banners). The production guard is unchanged:
  the dev driver refuses to start on Vercel.
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
   "Allow new users to sign up" **off**; minimum password length 10.
3. Supabase → Authentication → Hooks: *Send SMS* → Postgres
   `private.auth_hook_send_sms`; *Before User Created* → Postgres
   `private.auth_hook_before_user_created`.

Public sign-up is closed even if (2) is misconfigured: the deferred
`guard_auth_user_insert` trigger rejects any new `auth.users` row without the
server's OTP marker at commit (checked on staging: phone, anonymous and email
sign-ups → `SIGNUP_NOT_ALLOWED`).
