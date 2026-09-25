# WhatsApp templates and real-API verification

Templates to create in WhatsApp Manager (Meta Business Suite → WhatsApp
Manager → Message templates). Names, languages, categories and the number and
order of parameters **must match** `src/server/whatsapp/templates.ts`. The
test fake (`tests/fakes/meta-templates.json`) mirrors this table.

Every template is created twice: language **Arabic (`ar`)** and **English
(`en`)**. A customer receives the language of their profile (`profiles.locale`).

If the product name "Faris Digital" changes, the template texts must be edited
and approved again (template names stay the same).

## 1. `otp_code`: category Authentication

Meta writes the text of authentication templates itself; we only pick options.

| Option | Value |
|---|---|
| Code delivery | **Copy code** button |
| Add security recommendation ("For your security, do not share this code.") | yes |
| Add expiry time | yes, **5 minutes** (same as the OTP lifetime in the database) |
| Button text | ar: `نسخ الرمز`, en: `Copy code` |

What the app sends: body parameter `{{1}}` = the 6-digit code, and the button
(`sub_type: url`, `index: "0"`) with the same code as its parameter.

## 2. `order_status_update`: category Utility

Parameters: `{{1}}` order reference (`FD-1234567`), `{{2}}` status name
(from `order_statuses`, in the customer's language), `{{3}}` note from staff
(or `—` when there is none).

**ar**
```
تحديث على طلبك {{1}} في فارس ديجيتال: الحالة الآن {{2}}.
ملاحظة: {{3}}
يمكنك متابعة طلبك من حسابك في الموقع.
```

**en**
```
Update on your Faris Digital order {{1}}: the status is now {{2}}.
Note: {{3}}
You can follow your order from your account on the website.
```

Sample values for the review form: `FD-1000042`, `قيد التنفيذ` / `Processing`,
`سيصلك الرمز خلال ساعة` / `You will receive the code within an hour`.

## 3. `kyc_approved`: category Utility

No parameters.

**ar**
```
تم التحقق من هويتك في فارس ديجيتال. يمكنك الآن تقديم الطلبات التي تتطلب التحقق.
```

**en**
```
Your identity has been verified at Faris Digital. You can now place orders that require verification.
```

## 4. `kyc_rejected`: category Utility

Parameter: `{{1}}` the reason written by staff.

**ar**
```
لم نتمكن من قبول مستند الهوية الذي أرسلته إلى فارس ديجيتال. السبب: {{1}}.
يمكنك رفع مستند جديد من حسابك في الموقع.
```

**en**
```
We could not accept the identity document you sent to Faris Digital. Reason: {{1}}.
You can upload a new document from your account on the website.
```

Sample value: `الصورة غير واضحة` / `The photo is not readable`.

Meta rules the texts already follow: no parameter at the very start or end of
the body, no two parameters side by side, no promotional wording in Utility
templates. Values are cleaned before sending (newlines and repeated spaces
collapsed, maximum 300 characters, empty → `—`), because Meta refuses them.

---

## Verify against the real API (Phase 10)

Built and tested against a fake Graph API (`tests/fakes/meta-graph.mjs`) that
follows Meta's documented contract. Nothing below has been checked against
Meta itself: credentials and template approval did not exist during Phase 7.
Each item names what to do and what to look for.

**Account and templates**
1. The four templates are **approved** in both `ar` and `en` with the exact
   names above. Send each one once to a real test phone, in both languages,
   from the app (register, change an order's status with and without a note,
   approve and reject a KYC submission). Check the text renders correctly in
   RTL and that `—` looks acceptable for an empty note.
2. Language codes: Meta accepts `ar` and `en` for these templates (`en` vs
   `en_US`). A wrong code shows as error `meta:132001` in the dashboard.
3. Authentication template: the copy-code button payload (`sub_type: url`,
   `index: "0"`, code as the parameter) is accepted, and the button copies the
   code. If Meta asks for a different button shape, only `templatePayload()`
   changes.
4. While the Meta app is in development mode, only registered test numbers
   receive messages (`meta:131030`). Switch the app to live before launch.

**Sending**
5. `WHATSAPP_API_VERSION` (default `v23.0`) is still supported; success
   responses carry `messages[0].id` (the driver reads that `wamid`).
6. Error bodies look like `{ error: { code, … } }`. Provoke and compare with
   the dashboard labels: bad token (`190`), template missing (`132001`),
   wrong parameter count (`132000`), a number without WhatsApp (`131026`),
   a sandbox recipient (`131030`). Confirm which errors Meta reports
   **synchronously** and which only through a `failed` webhook; both paths are
   handled, but the retry classification in `meta-driver.ts`
   (`RETRYABLE_CODES`) should be reviewed against what is actually seen.
7. Per-message timeout (`WHATSAPP_API_TIMEOUT_MS`, default 10 s) is
   comfortable for real latency from Vercel's region.

**Webhook**
8. In the Meta app, subscribe the webhook URL
   `https://<domain>/api/whatsapp/webhook` to the **messages** field. The GET
   handshake must answer with the challenge. **Then remove
   `WHATSAPP_VERIFY_TOKEN` from Vercel**: Meta sends it in the URL, so it
   appears in request logs; without it the endpoint refuses any new handshake.
9. A real delivery report passes `X-Hub-Signature-256` verification with
   `WHATSAPP_APP_SECRET` (Vercel must hand the raw body over unchanged), and
   the message moves to delivered / read in the dashboard.
10. Status payload fields used: `statuses[].id`, `status`, `timestamp`,
    `errors[0].code`, `pricing.billable`, `pricing.category`. Check the pricing
    object under per-message pricing: if Meta reports a category other than
    `authentication`, `utility`, `marketing` or `service` (e.g. an
    international authentication category), the category is ignored and the
    estimate stays; decide then whether to add it.
11. `metadata.phone_number_id` equals `WHATSAPP_PHONE_NUMBER_ID` (reports for
    other numbers are ignored by design).
12. Meta redelivers webhooks that get a non-2xx answer; the endpoint answers
    500 on a database error on purpose. Confirm redelivery happens.

**Cost**
13. Enter the real per-message rates for Sudan (Meta's rate card, USD) for
    `utility` and `authentication` in *WhatsApp messages → Rates*. Compare the
    dashboard's spend for a sample day with WhatsApp Manager → Insights.
14. Utility templates sent inside an open customer-service window are free
    under per-message pricing (`billable: false` → cost 0 in the dashboard).
    Check one real case.

**Scheduler (retries)**
15. On the hosted project: `pg_net` and `pg_cron` enabled (the migration
    creates `pg_net`; check it applied), and the two Vault secrets set
    (docs/handover.md). Queue a message while the site is up, confirm the next
    minute's tick calls `/api/whatsapp/dispatch`
    (`select * from net._http_response order by id desc limit 5` shows 200).
16. Vercel Deployment Protection must not cover the production domain's
    `/api/whatsapp/*` (Meta and the database scheduler cannot log in).
17. `maxDuration = 60` on the dispatch route is accepted by the Vercel plan in
    use.
