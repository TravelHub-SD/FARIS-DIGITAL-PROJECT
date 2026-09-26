-- STAGING DEMO DATA ONLY (faris-digital-staging). Never run against
-- production (CLAUDE.md rule 8). Run after all migrations and supabase/seed.sql.
--
-- Three demo accounts sign in with phone + password; the password HASHES are
-- psql variables so no credential is stored in the repository:
--   psql "$STAGING_DB_URL" -v owner_hash=... -v staff_hash=... -v customer_hash=... -f demo-seed.sql
-- (hash = select extensions.crypt('<password>', extensions.gen_salt('bf', 10))).
-- Other demo customers have no password and cannot sign in.
--
-- Every business step goes through the same database functions the app uses
-- (review_receipt, change_order_status, review_kyc, void/reissue_invoice),
-- run as the demo staff member, so status history, audit log, invoices and
-- the WhatsApp outbox fill in exactly as they would in real use.
--
-- Not seeded: receipt and identity-document IMAGES. Files live in Storage,
-- which this script cannot write; those rows point to paths without a file,
-- so the review screens show "no image" for them. Upload a real receipt or
-- document from the site to see those screens with images.

begin;

-- 1. Accounts -----------------------------------------------------------------
create temp table demo_users (id uuid, phone text, name text, locale text, pw text) on commit drop;
insert into demo_users values
  ('d0000000-0000-4000-8000-000000000001', '249900000001', 'مالك المتجر', 'ar', :'owner_hash'),
  ('d0000000-0000-4000-8000-000000000002', '249900000002', 'موظف الطلبات', 'ar', :'staff_hash'),
  ('d0000000-0000-4000-8000-000000000003', '249900000003', 'عميل تجريبي', 'ar', :'customer_hash'),
  ('d0000000-0000-4000-8000-000000000011', '249900000011', 'أحمد عثمان', 'ar', null),
  ('d0000000-0000-4000-8000-000000000012', '249900000012', 'سارة علي', 'ar', null),
  ('d0000000-0000-4000-8000-000000000013', '249900000013', 'Amina Yousif', 'en', null),
  ('d0000000-0000-4000-8000-000000000014', '249900000014', 'خالد إبراهيم', 'ar', null),
  ('d0000000-0000-4000-8000-000000000015', '249900000015', 'Omar Hassan', 'en', null),
  ('d0000000-0000-4000-8000-000000000016', '249900000016', 'منى الطيب', 'ar', null);

insert into auth.users (
  id, instance_id, aud, role, phone, phone_confirmed_at, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change, phone_change_token, email_change_token_current, reauthentication_token)
select id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       phone, now(), pw,
       '{"provider":"phone","providers":["phone"],"signup_verified":"otp"}'::jsonb,
       jsonb_build_object('full_name', name, 'locale', locale), now(), now(),
       '', '', '', '', '', '', '', ''
  from demo_users;

insert into auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at)
select gen_random_uuid(), id::text, id,
       jsonb_build_object('sub', id::text, 'phone', phone, 'phone_verified', true, 'email_verified', false),
       'phone', now(), now()
  from demo_users;

insert into public.admins (user_id, is_owner) values
  ('d0000000-0000-4000-8000-000000000001', true),
  ('d0000000-0000-4000-8000-000000000002', false);
insert into public.admin_permissions (admin_id, permission) values
  ('d0000000-0000-4000-8000-000000000002', 'orders');

-- 2. Settings and content ----------------------------------------------------
update public.app_settings
   set contact_phone = '+249900000100',
       contact_whatsapp = '+249900000100',
       contact_email = 'staging@faris-digital.example',
       address_ar = 'الخرطوم (بيانات تجريبية)',
       address_en = 'Khartoum (demo data)',
       banner_title_ar = 'نسخة تجريبية: البيانات للعرض فقط',
       banner_title_en = 'Staging: demo data only',
       banner_link = '/c/games',
       banner_is_active = true
 where id;

insert into public.faqs (question_ar, question_en, answer_ar, answer_en, sort_order, is_published) values
  ('كيف أدفع؟', 'How do I pay?',
   'بتحويل بنكي إلى أحد حساباتنا، ثم ترفع صورة الإشعار ورقم العملية في صفحة الطلب.',
   'By bank transfer to one of our accounts, then upload the receipt and transaction number on the order page.', 1, true),
  ('متى يصل طلبي؟', 'When will my order arrive?',
   'بعد تأكيد الدفع، عادةً خلال ساعة في أوقات العمل.',
   'After the payment is confirmed, usually within an hour during working hours.', 2, true),
  ('لماذا يُطلب مني التحقق من الهوية؟', 'Why do I need to verify my identity?',
   'للطلبات التي تتجاوز حداً معيناً، حمايةً لك وللمتجر.',
   'For orders above a set amount, to protect you and the shop.', 3, true),
  ('هل أستطيع إلغاء الطلب؟', 'Can I cancel an order?',
   'نعم قبل تأكيد الدفع. تواصل معنا عبر واتساب.',
   'Yes, before the payment is confirmed. Contact us on WhatsApp.', 4, false);

-- 3. Comments (as their authors; one hidden by the owner) ---------------------
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000011","role":"authenticated"}', true);
insert into public.comments (product_id, body) values
  ('00000000-0000-4000-b000-000000000001', 'وصلت الشدات خلال ربع ساعة، شكراً.');
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000013","role":"authenticated"}', true);
insert into public.comments (product_id, body) values
  ('00000000-0000-4000-b000-000000000001', 'Fast and easy, paid by Bankak.'),
  ('00000000-0000-4000-b000-000000000002', 'Renewal done the same day.');
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000014","role":"authenticated"}', true);
insert into public.comments (product_id, body) values
  ('00000000-0000-4000-b000-000000000003', 'تعليق فيه رقم هاتف 0912345678 للتواصل خارج الموقع');
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
update public.comments set status = 'hidden', hidden_reason = 'رقم هاتف شخصي في التعليق'
 where body like 'تعليق فيه رقم هاتف%';

-- 4. KYC (reviews by the owner) ---------------------------------------------
select set_config('request.jwt.claims', '', true);
insert into public.kyc_submissions (id, user_id, doc_type, storage_path, file_sha256, mime, size_bytes) values
  ('d1000000-0000-4000-8000-000000000011', 'd0000000-0000-4000-8000-000000000011', 'national_id',
   'd0000000-0000-4000-8000-000000000011/d1000000-0000-4000-8000-000000000011.jpg', repeat('1', 64), 'image/jpeg', 120000),
  ('d1000000-0000-4000-8000-000000000012', 'd0000000-0000-4000-8000-000000000012', 'passport',
   'd0000000-0000-4000-8000-000000000012/d1000000-0000-4000-8000-000000000012.jpg', repeat('2', 64), 'image/jpeg', 140000),
  ('d1000000-0000-4000-8000-000000000013', 'd0000000-0000-4000-8000-000000000013', 'passport',
   'd0000000-0000-4000-8000-000000000013/d1000000-0000-4000-8000-000000000013.jpg', repeat('3', 64), 'image/jpeg', 150000),
  ('d1000000-0000-4000-8000-000000000014', 'd0000000-0000-4000-8000-000000000014', 'driving_license',
   'd0000000-0000-4000-8000-000000000014/d1000000-0000-4000-8000-000000000014.jpg', repeat('4', 64), 'image/jpeg', 110000);
update public.profiles set kyc_status = 'pending'
 where id in ('d0000000-0000-4000-8000-000000000011', 'd0000000-0000-4000-8000-000000000012',
              'd0000000-0000-4000-8000-000000000013', 'd0000000-0000-4000-8000-000000000014');

select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public.review_kyc('d1000000-0000-4000-8000-000000000013', true);
select public.review_kyc('d1000000-0000-4000-8000-000000000014', false, 'الصورة غير واضحة، أعد التصوير في إضاءة جيدة');
select public.kyc_mark_file_deleted('d1000000-0000-4000-8000-000000000013');
select public.kyc_mark_file_deleted('d1000000-0000-4000-8000-000000000014');

-- 5. Orders (through review_receipt / change_order_status as the staff member)
select set_config('request.jwt.claims', '', true);
create temp table demo_orders (n int, user_id uuid, variant uuid, qty int, data jsonb, target text) on commit drop;
insert into demo_orders values
  -- demo customer: one order in each state
  (1, 'd0000000-0000-4000-8000-000000000003', '00000000-0000-4000-c000-000000000001', 2, '{"player_id":"5123456789"}', 'new'),
  (2, 'd0000000-0000-4000-8000-000000000003', '00000000-0000-4000-c000-000000000004', 1, '{"player_id":"123456789","server":"mena"}', 'receipt'),
  (3, 'd0000000-0000-4000-8000-000000000003', '00000000-0000-4000-c000-000000000003', 1, '{"player_id":"5123456789"}', 'processing'),
  (4, 'd0000000-0000-4000-8000-000000000003', '00000000-0000-4000-c000-000000000001', 3, '{"player_id":"5123456789"}', 'completed'),
  (5, 'd0000000-0000-4000-8000-000000000003', '00000000-0000-4000-c000-000000000005', 1, '{"target_phone":"+249912345678"}', 'completed'),
  (6, 'd0000000-0000-4000-8000-000000000003', '00000000-0000-4000-c000-000000000006', 1, '{"delivery_email":"demo@example.com"}', 'cancelled'),
  -- other customers
  (7, 'd0000000-0000-4000-8000-000000000011', '00000000-0000-4000-c000-000000000003', 2, '{"player_id":"7788990011"}', 'completed'),
  (8, 'd0000000-0000-4000-8000-000000000012', '00000000-0000-4000-c000-000000000004', 3, '{"player_id":"987654321","server":"eu"}', 'receipt'),
  (9, 'd0000000-0000-4000-8000-000000000013', '00000000-0000-4000-c000-000000000002', 1, '{"account_email":"amina@example.com"}', 'completed'),
  (10, 'd0000000-0000-4000-8000-000000000013', '00000000-0000-4000-c000-000000000006', 1, '{"delivery_email":"amina@example.com"}', 'processing'),
  (11, 'd0000000-0000-4000-8000-000000000015', '00000000-0000-4000-c000-000000000001', 1, '{"player_id":"5566778899"}', 'rejected'),
  (12, 'd0000000-0000-4000-8000-000000000016', '00000000-0000-4000-c000-000000000005', 2, '{"target_phone":"+249123456789"}', 'completed');

do $$
declare
  c_staff constant text := '{"sub":"d0000000-0000-4000-8000-000000000002","role":"authenticated"}';
  r record;
  v_id uuid;
  v_receipt uuid;
  v_bank uuid;
begin
  select id into v_bank from public.bank_accounts where is_active order by sort_order limit 1;
  for r in select * from demo_orders order by n loop
    perform set_config('request.jwt.claims', '', true);
    insert into public.orders (user_id, variant_id, quantity, fulfillment_data, idempotency_key)
    values (r.user_id, r.variant, r.qty, r.data, gen_random_uuid())
    returning id into v_id;
    if r.target <> 'new' and r.target <> 'cancelled' then
      insert into public.payment_receipts (order_id, bank_account_id, transaction_ref, storage_path, file_sha256)
      values (v_id, v_bank, 'DEMO' || lpad(r.n::text, 6, '0'),
              r.user_id || '/' || v_id || '/' || gen_random_uuid() || '.jpg',
              encode(extensions.digest('faris-demo-receipt-' || r.n, 'sha256'), 'hex'))
      returning id into v_receipt;
    end if;
    perform set_config('request.jwt.claims', c_staff, true);
    if r.target in ('processing', 'completed') then
      perform public.review_receipt(v_receipt, true);
    elsif r.target = 'rejected' then
      perform public.review_receipt(v_receipt, false, 'المبلغ في الإشعار لا يطابق قيمة الطلب');
    end if;
    if r.target = 'completed' then
      perform public.change_order_status(v_id, 'completed', 'تم التنفيذ، شكراً لتسوقك معنا');
    elsif r.target = 'cancelled' then
      perform public.change_order_status(v_id, 'cancelled', 'أُلغي بطلب من العميل');
    end if;
    if r.n = 8 then
      insert into public.order_internal_notes (order_id, body)
      values (v_id, 'اتصلت بالعميلة: ستحول الفرق من حساب آخر. (ملاحظة داخلية لا يراها العميل)');
    end if;
  end loop;
end
$$;

-- 6. Owner actions: correct one invoice (void + re-issue), block a customer --
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public.void_invoice(i.id, 'اسم العميلة ناقص في الفاتورة')
  from public.invoices i join public.orders o on o.id = i.order_id
 where o.user_id = 'd0000000-0000-4000-8000-000000000016' and i.status = 'issued';
update public.profiles set full_name = 'منى الطيب محمد' where id = 'd0000000-0000-4000-8000-000000000016';
select public.reissue_invoice(o.id) from public.orders o
 where o.user_id = 'd0000000-0000-4000-8000-000000000016' and o.status = 'completed';
select public.set_customer_blocked('d0000000-0000-4000-8000-000000000015', true);

select set_config('request.jwt.claims', '', true);
commit;
