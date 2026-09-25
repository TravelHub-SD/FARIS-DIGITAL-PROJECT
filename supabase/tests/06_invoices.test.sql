-- Phase 8 invoices: issued on completion, gapless numbering (including a
-- rolled-back completion), snapshot contents and immutability, void /
-- re-issue permissions, history and search under RLS.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(36);

insert into auth.users (id, instance_id, aud, role, email, phone, phone_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('10000000-0000-4000-8000-000000000061', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'inv-a@test.local', '249911000061', now(),
   '{"signup_verified":"otp"}', '{}', now(), now()),
  ('10000000-0000-4000-8000-000000000062', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'inv-b@test.local', '249911000062', now(),
   '{"signup_verified":"otp"}', '{}', now(), now()),
  ('10000000-0000-4000-8000-000000000063', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'inv-staff@test.local', '249911000063', now(),
   '{"signup_verified":"otp"}', '{}', now(), now()),
  ('10000000-0000-4000-8000-000000000064', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'inv-orders@test.local', '249911000064', now(),
   '{"signup_verified":"otp"}', '{}', now(), now());
update profiles set full_name = 'أحمد عثمان' where id = '10000000-0000-4000-8000-000000000061';
update profiles set full_name = 'Sara Ali' where id = '10000000-0000-4000-8000-000000000062';
insert into admins (user_id) values ('10000000-0000-4000-8000-000000000063'), ('10000000-0000-4000-8000-000000000064');
insert into admin_permissions (admin_id, permission) values
  ('10000000-0000-4000-8000-000000000063', 'invoices'),
  ('10000000-0000-4000-8000-000000000064', 'orders');
update app_settings set usd_sdg_rate = 2600, kyc_threshold_usd = 100 where id;

create function pg_temp.new_order(p_user uuid) returns uuid language sql as $$
  insert into public.orders (user_id, variant_id, quantity, idempotency_key, fulfillment_data)
  values (p_user, '00000000-0000-4000-c000-000000000001', 3, gen_random_uuid(), '{"player_id":"123456"}')
  returning id;
$$;
create function pg_temp.pay(p_order uuid, p_ref text) returns void language plpgsql as $$
begin
  insert into public.payment_receipts (order_id, bank_account_id, transaction_ref, storage_path, file_sha256)
  select p_order, id, p_ref, p_ref || '.jpg', md5(p_ref) || md5(p_ref || 'x')
    from public.bank_accounts order by sort_order limit 1;
  update public.payment_receipts set status = 'accepted', reviewed_at = now() where order_id = p_order;
  update public.orders set status = 'processing' where id = p_order;
end;
$$;
create function pg_temp.counter() returns integer language sql as $$
  select coalesce((select last_value from private.invoice_counters
                    where year = extract(year from now() at time zone 'Africa/Khartoum')::int), 0);
$$;

create temp table o (n int primary key, id uuid) on commit drop;
insert into o values
  (1, pg_temp.new_order('10000000-0000-4000-8000-000000000061')),
  (2, pg_temp.new_order('10000000-0000-4000-8000-000000000061')),
  (3, pg_temp.new_order('10000000-0000-4000-8000-000000000062')),
  (4, pg_temp.new_order('10000000-0000-4000-8000-000000000062'));
select pg_temp.pay(id, 'INVTX' || n) from o;
grant select on o to authenticated;

-- Issued by the completion itself, numbered from the counter.
create temp table start on commit drop as select pg_temp.counter() as v;
grant select on start to authenticated;
update orders set status = 'completed' where id = (select id from o where n = 1);
select is((select count(*)::int from invoices where order_id = (select id from o where n = 1)), 1,
          'completion issued one invoice');
select is((select invoice_number from invoices where order_id = (select id from o where n = 1)),
          'INV-' || extract(year from now() at time zone 'Africa/Khartoum')::int || '-' || lpad(((select v from start) + 1)::text, 5, '0'),
          'number = next counter value, INV-YYYY-NNNNN');

-- A completion that rolls back gives its number back: no gap.
savepoint before_failed;
update orders set status = 'completed' where id = (select id from o where n = 2);
select is(pg_temp.counter(), (select v from start) + 2, 'inside the failing transaction the number was taken');
rollback to savepoint before_failed;
select is(pg_temp.counter(), (select v from start) + 1, 'after rollback the counter is back');
update orders set status = 'completed' where id = (select id from o where n = 3);
update orders set status = 'completed' where id = (select id from o where n = 2);
select results_eq(
  $$ select right(invoice_number, 5)::int - (select v from start)
       from invoices where order_id in (select id from o) order by invoice_number $$,
  $$ values (1), (2), (3) $$,
  'numbers are contiguous: the rolled-back completion left no gap');
select is((select count(distinct invoice_number)::int from invoices), (select count(*)::int from invoices),
          'numbers are unique');

-- Snapshot: everything the invoice shows, copied at issue time.
create temp table inv1 on commit drop as
  select * from invoices where order_id = (select id from o where n = 1);
grant select on inv1 to authenticated;
select is((select snapshot #>> '{customer,full_name}' from inv1), 'أحمد عثمان', 'customer name copied');
select is((select snapshot #>> '{customer,phone}' from inv1), '+249911000061', 'customer phone copied');
select is((select snapshot #>> '{seller,name_ar}' from inv1), 'فارس ديجيتال', 'seller name copied');
select is((select snapshot #>> '{payment,transaction_ref}' from inv1), 'INVTX1', 'accepted payment copied');
select results_eq(
  $$ select total_usd, usd_sdg_rate, total_sdg, (snapshot #>> '{order,quantity}')::int from inv1 $$,
  $$ values (3.30::numeric, 2600::numeric, 8580::numeric, 3) $$,
  'money and quantity from the order snapshot');

-- Later changes to everything the invoice was built from change nothing.
update product_variants set price_usd = 7.77, name_ar = 'اسم جديد' where id = '00000000-0000-4000-c000-000000000001';
update app_settings set usd_sdg_rate = 3100, business_name_ar = 'اسم تجاري جديد', contact_phone = '+249999999999' where id;
update profiles set full_name = 'اسم معدل' where id = '10000000-0000-4000-8000-000000000061';
update auth.users set phone = '249911000099' where id = '10000000-0000-4000-8000-000000000061';
update bank_accounts set bank_name_ar = 'بنك آخر';
select is((select row_to_json(i)::text from invoices i where id = (select id from inv1)),
          (select row_to_json(i)::text from inv1 i),
          'invoice row identical after price, rate, seller, profile, phone and bank changes');

-- Void and re-issue: invoices permission only; reason required; audited.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000061","role":"authenticated"}';
select throws_ok($$ select void_invoice((select id from inv1), 'x') $$, '42501', 'FORBIDDEN', 'customer cannot void');
select throws_ok($$ select reissue_invoice((select id from o where n = 1)) $$, '42501', 'FORBIDDEN', 'customer cannot re-issue');
select throws_ok($$ insert into invoices (order_id) values ((select id from o where n = 4)) $$, '42501', null,
                 'customer cannot insert invoices');
select throws_ok($$ update invoices set status = 'void', void_reason = 'x' $$, '42501', null,
                 'customer cannot update invoices');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000064","role":"authenticated"}';
select throws_ok($$ select void_invoice((select id from inv1), 'x') $$, '42501', 'FORBIDDEN', 'orders-only staff cannot void');
select is((select count(*)::int from invoices), 0, 'orders-only staff cannot read invoices');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000063","role":"authenticated"}';
select throws_ok($$ select void_invoice((select id from inv1), '   ') $$, 'P0001', 'VOID_REASON_REQUIRED', 'reason required');
select lives_ok($$ select void_invoice((select id from inv1), 'اسم العميل خاطئ') $$, 'invoices staff can void');
select throws_ok($$ select void_invoice((select id from inv1), 'again') $$, 'P0002', 'INVOICE_NOT_FOUND', 'cannot void twice');
select throws_ok($$ select reissue_invoice((select id from o where n = 3)) $$, 'P0001', 'INVOICE_ALREADY_ISSUED',
                 'no second issued invoice for an order');
select lives_ok($$ select reissue_invoice((select id from o where n = 1)) $$, 'invoices staff can re-issue after void');
reset role;
select is((select status::text || '/' || void_reason || '/' || voided_by::text from invoices where id = (select id from inv1)),
          'void/اسم العميل خاطئ/10000000-0000-4000-8000-000000000063', 'void recorded with reason and staff member');
select results_eq(
  $$ select snapshot #>> '{customer,full_name}', right(invoice_number, 5)::int - (select v from start),
            issued_by::text, total_sdg
       from invoices where order_id = (select id from o where n = 1) and status = 'issued' $$,
  $$ values ('اسم معدل', 4, '10000000-0000-4000-8000-000000000063', 8580::numeric) $$,
  're-issued invoice: next number, current name, original order money');
select is((select count(*)::int from audit_logs where entity_type = 'invoices'
            and entity_id = (select id::text from inv1) and action = 'invoices.update'), 1, 'void is audited');

-- History and search (SECURITY INVOKER: RLS decides what each caller sees).
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000061","role":"authenticated"}';
select results_eq(
  $$ select count(*)::int from search_invoices() $$, $$ values (2) $$,
  'customer A lists their 2 issued invoices (the void one is hidden)');
select is((select count(*)::int from search_invoices((select invoice_number from invoices limit 0))), 2,
          'empty query = all own');
select is((select count(*)::int from search_invoices('Sara')), 0, 'customer A cannot find customer B by name');
select is((select count(*)::int from invoices where order_id in (select id from o where n in (3, 4))), 0,
          'customer A cannot read B''s invoices from the table');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000063","role":"authenticated"}';
select is((select count(*)::int from search_invoices(p_status => 'void')), 1, 'staff: filter by status');
select is((select count(*)::int from search_invoices(p_mine => true)), 0,
          'staff: "my invoices" lists only their own (none), not everyone''s');
select is((select count(*)::int from search_invoices('احمد')), 2,
          'staff: Arabic search normalises alef forms (احمد finds both invoices issued to أحمد)');
select is((select count(*)::int from search_invoices('sara ali')), 1, 'staff: search by customer name (case-insensitive)');
select is((select count(*)::int from search_invoices('0911000062')), 1, 'staff: search by local phone 09…');
select is((select count(*)::int from search_invoices((select invoice_number from invoices where order_id = (select id from o where n = 3)))), 1,
          'staff: search by invoice number');
reset role;

select * from finish();
rollback;
