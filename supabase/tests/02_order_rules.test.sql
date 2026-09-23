-- KYC threshold, status transitions, duplicate receipts, gapless invoice numbers.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(16);

insert into auth.users (id, instance_id, aud, role, email, phone, phone_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('10000000-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rules@test.local', '249911000011', now(),
   '{"signup_verified":"otp"}', '{}', now(), now()),
  ('10000000-0000-4000-8000-000000000012', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'nophone@test.local', null, null,
   '{"signup_verified":"otp"}', '{}', now(), now());

update app_settings set usd_sdg_rate = 2600, kyc_threshold_usd = 100 where id;

-- KYC threshold (USD, decisions.md): 120 USD variant, customer not verified.
select throws_ok(
  $$ insert into orders (user_id, variant_id, quantity, idempotency_key)
     values ('10000000-0000-4000-8000-000000000011', '00000000-0000-4000-c000-000000000002', 1, gen_random_uuid()) $$,
  'P0001', 'KYC_REQUIRED', 'order >= threshold refused while KYC is not verified');

update profiles set kyc_status = 'verified' where id = '10000000-0000-4000-8000-000000000011';
select lives_ok(
  $$ insert into orders (user_id, variant_id, quantity, idempotency_key)
     values ('10000000-0000-4000-8000-000000000011', '00000000-0000-4000-c000-000000000002', 1, gen_random_uuid()) $$,
  'same order accepted once KYC is verified');
update profiles set kyc_status = 'none' where id = '10000000-0000-4000-8000-000000000011';

select lives_ok(
  $$ insert into orders (id, user_id, variant_id, quantity, idempotency_key)
     values ('20000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000011',
             '00000000-0000-4000-c000-000000000001', 1, gen_random_uuid()) $$,
  'order below threshold does not need KYC');

select throws_ok(
  $$ insert into orders (user_id, variant_id, quantity, idempotency_key)
     values ('10000000-0000-4000-8000-000000000012', '00000000-0000-4000-c000-000000000001', 1, gen_random_uuid()) $$,
  'P0001', 'PHONE_NOT_VERIFIED', 'customer without a verified phone cannot order');

select throws_ok(
  $$ insert into orders (user_id, variant_id, quantity, idempotency_key)
     values ('10000000-0000-4000-8000-000000000011', '00000000-0000-4000-c000-000000000001', 9, gen_random_uuid()) $$,
  'P0001', 'INVALID_QUANTITY', 'quantity above the variant max is refused');

update product_variants set is_active = false where id = '00000000-0000-4000-c000-000000000001';
select throws_ok(
  $$ insert into orders (user_id, variant_id, quantity, idempotency_key)
     values ('10000000-0000-4000-8000-000000000011', '00000000-0000-4000-c000-000000000001', 1, gen_random_uuid()) $$,
  'P0001', 'VARIANT_UNAVAILABLE', 'inactive variant cannot be ordered');
update product_variants set is_active = true where id = '00000000-0000-4000-c000-000000000001';

-- Status machine.
select throws_like(
  $$ update orders set status = 'completed' where id = '20000000-0000-4000-8000-000000000011' $$,
  'INVALID_STATUS_TRANSITION%', 'new → completed is not a valid transition');
select throws_ok(
  $$ update orders set status = 'processing' where id = '20000000-0000-4000-8000-000000000011' $$,
  'P0001', 'PAYMENT_NOT_ACCEPTED', 'new → processing requires an accepted receipt');

-- Duplicate transfer numbers (normalised: case, spaces, dashes).
insert into payment_receipts (order_id, bank_account_id, transaction_ref, storage_path, file_sha256)
select '20000000-0000-4000-8000-000000000011', id, 'ab-12 345', 'r1.jpg', repeat('b', 64)
  from bank_accounts order by sort_order limit 1;

insert into orders (id, user_id, variant_id, quantity, idempotency_key)
values ('20000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000011',
        '00000000-0000-4000-c000-000000000001', 1, gen_random_uuid());

select throws_ok(
  $$ insert into payment_receipts (order_id, bank_account_id, transaction_ref, storage_path, file_sha256)
     select '20000000-0000-4000-8000-000000000013', id, 'AB12345', 'r2.jpg', repeat('c', 64)
       from bank_accounts order by sort_order limit 1 $$,
  '23505', null, 'same transaction number on the same bank is refused (normalised)');

select lives_ok(
  $$ insert into payment_receipts (order_id, bank_account_id, transaction_ref, storage_path, file_sha256)
     select '20000000-0000-4000-8000-000000000013', id, 'AB12345', 'r2.jpg', repeat('c', 64)
       from bank_accounts order by sort_order offset 1 limit 1 $$,
  'same number on a DIFFERENT bank is allowed');

update payment_receipts set status = 'rejected', rejection_reason = 'unreadable', reviewed_at = now()
 where order_id = '20000000-0000-4000-8000-000000000011';
select lives_ok(
  $$ insert into payment_receipts (order_id, bank_account_id, transaction_ref, storage_path, file_sha256)
     select '20000000-0000-4000-8000-000000000011', id, 'AB-12345', 'r3.jpg', repeat('d', 64)
       from bank_accounts order by sort_order limit 1 $$,
  'a number from a REJECTED receipt can be resubmitted');

select is(
  (select user_id from payment_receipts where storage_path = 'r3.jpg'),
  '10000000-0000-4000-8000-000000000011'::uuid,
  'receipt owner is derived from the order, not the caller');

-- Gapless invoice numbering: a failed issue does not consume a number.
update payment_receipts set status = 'accepted', reviewed_at = now() where storage_path = 'r3.jpg';
update orders set status = 'processing' where id = '20000000-0000-4000-8000-000000000011';
update orders set status = 'completed' where id = '20000000-0000-4000-8000-000000000011';

select throws_ok(
  $$ insert into invoices (order_id, total_usd, usd_sdg_rate, total_sdg, snapshot)
     values ('20000000-0000-4000-8000-000000000013', 0, 0, 0, '{}') $$,
  'P0001', 'ORDER_NOT_COMPLETED', 'no invoice for an order that is not completed');

insert into invoices (order_id, total_usd, usd_sdg_rate, total_sdg, snapshot)
values ('20000000-0000-4000-8000-000000000011', 0, 0, 0, '{}');

select is(
  (select invoice_number from invoices where order_id = '20000000-0000-4000-8000-000000000011'),
  'INV-' || extract(year from now() at time zone 'Africa/Khartoum')::int || '-' ||
    lpad(((select last_value from private.invoice_counters
            where year = extract(year from now() at time zone 'Africa/Khartoum')::int))::text, 5, '0'),
  'invoice number = current counter value (the failed attempt consumed nothing)');

select throws_ok(
  $$ insert into invoices (order_id, total_usd, usd_sdg_rate, total_sdg, snapshot)
     values ('20000000-0000-4000-8000-000000000011', 0, 0, 0, '{}') $$,
  '23505', null, 'only one issued invoice per order');

select throws_ok(
  $$ insert into message_logs (phone_e164, message_type, template_name, payload)
     values ('+249911000011', 'otp', 'auth_otp', '{"code":"123456"}') $$,
  '23514', null, 'an OTP message log cannot carry a payload (no plaintext codes)');

select * from finish();
rollback;
