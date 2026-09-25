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
