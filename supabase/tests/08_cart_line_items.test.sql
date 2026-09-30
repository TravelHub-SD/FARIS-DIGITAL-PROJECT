-- Cart and orders with line items (Stage 2 of the redesign, decisions.md
-- 2026-09-30): per-line derivation and rounding, the header follows its
-- lines, immutability, KYC on the order total and the rolling window, the
-- window setting's permissions and audit, cart RLS and validation, checkout.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(57);

insert into auth.users (id, instance_id, aud, role, email, phone, phone_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('10000000-0000-4000-8000-000000000081', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cart-a@test.local', '249911000081', now(),
   '{"signup_verified":"otp"}', '{}', now(), now()),
  ('10000000-0000-4000-8000-000000000082', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cart-b@test.local', '249911000082', now(),
   '{"signup_verified":"otp"}', '{}', now(), now()),
  ('10000000-0000-4000-8000-000000000083', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cart-settings@test.local', '249911000083', now(),
   '{"signup_verified":"otp"}', '{}', now(), now()),
  ('10000000-0000-4000-8000-000000000084', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cart-orders@test.local', '249911000084', now(),
   '{"signup_verified":"otp"}', '{}', now(), now());
insert into admins (user_id) values ('10000000-0000-4000-8000-000000000083'), ('10000000-0000-4000-8000-000000000084');
insert into admin_permissions (admin_id, permission) values
  ('10000000-0000-4000-8000-000000000083', 'settings'),
  ('10000000-0000-4000-8000-000000000084', 'orders');

update app_settings set usd_sdg_rate = 2600.3333, kyc_threshold_usd = 100 where id;
update security_settings set kyc_window_hours = 24 where id;

create function pg_temp.line(p_variant text, p_qty int, p_data jsonb) returns jsonb language sql as $$
  select jsonb_build_object('variant_id', p_variant, 'quantity', p_qty, 'fulfillment_data', p_data);
$$;
create function pg_temp.as_user(p_id text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
end;
$$;

-- 1. Several lines, one order; per-line rounding -------------------------------
select private.insert_order('10000000-0000-4000-8000-000000000081', jsonb_build_array(
    pg_temp.line('00000000-0000-4000-c000-000000000001', 1, '{"player_id":"123456"}'),
    pg_temp.line('00000000-0000-4000-c000-000000000001', 1, '{"player_id":"654321"}'),
    pg_temp.line('00000000-0000-4000-c000-000000000004', 2, '{"player_id":"1234567","server":"eu"}')),
  gen_random_uuid(), '20000000-0000-4000-8000-000000000081');

select results_eq(
  $$ select line_no, unit_price_usd, line_total_usd, line_total_sdg from order_items
      where order_id = '20000000-0000-4000-8000-000000000081' order by line_no $$,
  $$ values (1::smallint, 1.10::numeric, 1.10::numeric, 2861::numeric),
            (2::smallint, 1.10::numeric, 1.10::numeric, 2861::numeric),
            (3::smallint, 1.00::numeric, 2.00::numeric, 5201::numeric) $$,
  'three lines, each priced from its variant and rounded up on its own (ceil(1.10 × 2600.3333) = 2861)');
select results_eq(
  $$ select total_usd, total_sdg from orders where id = '20000000-0000-4000-8000-000000000081' $$,
  $$ values (4.20::numeric, 10923::numeric) $$,
  'order total = sum of the lines (10923; rounding once would give ceil(4.20 × 2600.3333) = 10922)');
select is((select count(distinct reference)::int from orders where id = '20000000-0000-4000-8000-000000000081'),
          1, 'one order, one reference for the whole cart');

-- 2. Forged line values are replaced; lines are immutable ----------------------
insert into orders (id, user_id, idempotency_key)
values ('20000000-0000-4000-8000-000000000082', '10000000-0000-4000-8000-000000000081', gen_random_uuid());
insert into order_items (order_id, variant_id, quantity, unit_price_usd, line_total_usd,
                         usd_sdg_rate, line_total_sdg, product_name_en, fulfillment_data)
values ('20000000-0000-4000-8000-000000000082', '00000000-0000-4000-c000-000000000003', 2,
        0.01, 0.02, 1, 1, 'forged', '{"player_id":"123456"}'),
       ('20000000-0000-4000-8000-000000000082', '00000000-0000-4000-c000-000000000001', 1,
        0.01, 0.01, 1, 1, 'forged', '{"player_id":"123456"}');
select results_eq(
  $$ select unit_price_usd, line_total_usd, usd_sdg_rate, line_total_sdg, product_name_en
       from order_items where order_id = '20000000-0000-4000-8000-000000000082' order by line_no $$,
  $$ values (5.20::numeric, 10.40::numeric, 2600.3333::numeric, 27044.00::numeric, 'PUBG UC'::text),
            (1.10::numeric, 1.10::numeric, 2600.3333::numeric, 2861::numeric, 'PUBG UC'::text) $$,
  'price tampering in a line: every forged money and name value replaced by the database');
select results_eq(
  $$ select total_usd, total_sdg from orders where id = '20000000-0000-4000-8000-000000000082' $$,
  $$ values (11.50::numeric, 29905::numeric) $$,
  'header totals follow the derived lines');
select throws_ok(
  $$ update order_items set line_total_sdg = 1 where order_id = '20000000-0000-4000-8000-000000000081' $$,
  '42501', 'ORDER_SNAPSHOT_IMMUTABLE', 'a line cannot be edited');
select throws_ok(
  $$ delete from order_items where order_id = '20000000-0000-4000-8000-000000000081' $$,
  '42501', null, 'a line cannot be deleted');
select throws_ok(
  $$ update orders set total_sdg = 1 where id = '20000000-0000-4000-8000-000000000081' $$,
  '42501', 'ORDER_SNAPSHOT_IMMUTABLE', 'order totals cannot be edited, even in the creating transaction');
select set_config('app.order_items_sync', '20000000-0000-4000-8000-000000000081', true);
update orders set total_sdg = 1, total_usd = 0.01 where id = '20000000-0000-4000-8000-000000000081';
select set_config('app.order_items_sync', '', true);
select results_eq(
  $$ select total_usd, total_sdg from orders where id = '20000000-0000-4000-8000-000000000081' $$,
  $$ values (4.20::numeric, 10923::numeric) $$,
  'even with the internal sync flag set by hand, totals are recomputed from the lines, never taken from the caller');
select throws_ok(
  $$ select private.assert_order_complete(o.id) from orders o
      where o.id = (select private.insert_order('10000000-0000-4000-8000-000000000082', '[]', gen_random_uuid())).id $$,
  'P0001', 'ORDER_HAS_NO_ITEMS', 'an order without lines is refused');
insert into orders (id, user_id, idempotency_key)
values ('20000000-0000-4000-8000-000000000083', '10000000-0000-4000-8000-000000000082', gen_random_uuid());
select throws_ok(
  $$ select private.assert_order_complete('20000000-0000-4000-8000-000000000083') $$,
  'P0001', 'ORDER_HAS_NO_ITEMS', 'a header inserted directly without lines fails the completeness check (deferred trigger at commit)');
select is((select count(*)::int from pg_trigger t where t.tgname = 'orders_complete_check'
            and t.tgdeferrable and t.tginitdeferred), 1,
          'the completeness check runs as a deferred constraint trigger for every insert path');

-- A line cannot be added once the order is past creation (status moved on).
insert into payment_receipts (order_id, bank_account_id, transaction_ref, storage_path, file_sha256)
select '20000000-0000-4000-8000-000000000081', id, 'CART-001', 'c1.jpg', repeat('e', 64)
  from bank_accounts order by sort_order limit 1;
update payment_receipts set status = 'accepted', reviewed_at = now()
 where order_id = '20000000-0000-4000-8000-000000000081';
update orders set status = 'processing' where id = '20000000-0000-4000-8000-000000000081';
select throws_ok(
  $$ insert into order_items (order_id, variant_id, quantity, fulfillment_data)
     values ('20000000-0000-4000-8000-000000000081', '00000000-0000-4000-c000-000000000001', 1, '{"player_id":"123456"}') $$,
  '42501', 'ORDER_ITEMS_LOCKED', 'no line can be added to an order that is no longer being created');

-- 3. Completion: one invoice with all lines; "most ordered" once per product --
create temp table counts on commit drop as
  select id, completed_orders_count from products
   where id in ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-b000-000000000003');
update orders set status = 'completed' where id = '20000000-0000-4000-8000-000000000081';
select results_eq(
  $$ select jsonb_array_length(snapshot -> 'items'),
            (select sum((l ->> 'line_total_sdg')::numeric) from jsonb_array_elements(snapshot -> 'items') l),
            total_sdg
       from invoices where order_id = '20000000-0000-4000-8000-000000000081' $$,
  $$ values (3, 10923::numeric, 10923::numeric) $$,
  'one invoice with the three lines, which add up to its total');
select results_eq(
  $$ select p.completed_orders_count - c.completed_orders_count from products p join counts c using (id) order by p.id $$,
  $$ values (1), (1) $$,
  'a completed order counts once for each product it contains (two lines of the same product count once)');

-- 4. Sensitive fields purged from every line when the order is final ---------
update product_variants
   set required_fields = '[{"key":"player_id","type":"digits","label_ar":"رقم","required":true,"min_length":5,"max_length":20,"sensitive":true},
                           {"key":"note","type":"text","label_ar":"ملاحظة","required":false}]'
 where id = '00000000-0000-4000-c000-000000000003';
select private.insert_order('10000000-0000-4000-8000-000000000082', jsonb_build_array(
    pg_temp.line('00000000-0000-4000-c000-000000000003', 1, '{"player_id":"99999","note":"x"}'),
    pg_temp.line('00000000-0000-4000-c000-000000000001', 1, '{"player_id":"123456"}')),
  gen_random_uuid(), '20000000-0000-4000-8000-000000000084');
update orders set status = 'cancelled' where id = '20000000-0000-4000-8000-000000000084';
select results_eq(
  $$ select fulfillment_data from order_items where order_id = '20000000-0000-4000-8000-000000000084' order by line_no $$,
  $$ values ('{"note":"x"}'::jsonb), ('{"player_id":"123456"}'::jsonb) $$,
  'on a final status the sensitive value is removed from the line that declares it, others kept');

-- 5. KYC on the order total (a split inside one cart does not avoid it) --------
update app_settings set kyc_threshold_usd = 5 where id;
update security_settings set kyc_window_hours = 0 where id;
select throws_ok(
  $$ select private.insert_order('10000000-0000-4000-8000-000000000082', jsonb_build_array(
       pg_temp.line('00000000-0000-4000-c000-000000000001', 3, '{"player_id":"123456"}'),
       pg_temp.line('00000000-0000-4000-c000-000000000001', 2, '{"player_id":"123456"}')), gen_random_uuid()) $$,
  'P0001', 'KYC_REQUIRED', 'KYC split attempt in one cart: lines of 3.30 and 2.20 USD (each below 5) total 5.50 → KYC required');
select lives_ok(
  $$ select private.insert_order('10000000-0000-4000-8000-000000000082', jsonb_build_array(
       pg_temp.line('00000000-0000-4000-c000-000000000001', 3, '{"player_id":"123456"}')), gen_random_uuid()) $$,
  'a 3.30 USD order alone is below the threshold');

-- 6. Rolling window: separate orders within N hours add up -----------------------
select lives_ok(
  $$ select private.insert_order('10000000-0000-4000-8000-000000000082', jsonb_build_array(
       pg_temp.line('00000000-0000-4000-c000-000000000001', 2, '{"player_id":"123456"}')), gen_random_uuid()) $$,
  'window 0 (disabled): a second 2.20 USD order is judged alone and passes');
update security_settings set kyc_window_hours = 24 where id;
select throws_ok(
  $$ select private.insert_order('10000000-0000-4000-8000-000000000082', jsonb_build_array(
       pg_temp.line('00000000-0000-4000-c000-000000000001', 1, '{"player_id":"123456"}')), gen_random_uuid()) $$,
  'P0001', 'KYC_REQUIRED', 'split-order attempt: 3.30 + 2.20 USD already ordered in 24 h, one more order → KYC required');
-- Cancelled orders do not count.
update orders set status = 'cancelled'
 where user_id = '10000000-0000-4000-8000-000000000082' and status = 'new';
select lives_ok(
  $$ select private.insert_order('10000000-0000-4000-8000-000000000082', jsonb_build_array(
       pg_temp.line('00000000-0000-4000-c000-000000000001', 1, '{"player_id":"123456"}')), gen_random_uuid()) $$,
  'cancelled orders are not counted in the window');
-- Orders older than the window do not count (created_at moved back for the test only).
set local session_replication_role = replica;  -- triggers off for this one setup update
update orders set created_at = now() - interval '25 hours'
 where user_id = '10000000-0000-4000-8000-000000000082' and status = 'new';
set local session_replication_role = origin;
select lives_ok(
  $$ select private.insert_order('10000000-0000-4000-8000-000000000082', jsonb_build_array(
       pg_temp.line('00000000-0000-4000-c000-000000000001', 4, '{"player_id":"123456"}')), gen_random_uuid()) $$,
  'an order from 25 hours ago is outside a 24-hour window');
select is((select kyc_required from orders where user_id = '10000000-0000-4000-8000-000000000082'
            and status = 'new' order by created_at desc limit 1), false,
          'kyc_required recorded on the order (false: 4.40 USD in the window)');
update profiles set kyc_status = 'verified' where id = '10000000-0000-4000-8000-000000000082';
select lives_ok(
  $$ select private.insert_order('10000000-0000-4000-8000-000000000082', jsonb_build_array(
       pg_temp.line('00000000-0000-4000-c000-000000000001', 5, '{"player_id":"123456"}')), gen_random_uuid()) $$,
  'a verified customer is not stopped by the window');
select is((select kyc_required from orders where user_id = '10000000-0000-4000-8000-000000000082'
            and status = 'new' and total_usd = 5.50), true,
          'kyc_required recorded as true for an order over the rolling total');
update profiles set kyc_status = 'none' where id = '10000000-0000-4000-8000-000000000082';

-- 7. The window setting: settings staff only, bounded, audited, not public ----
select pg_temp.as_user('10000000-0000-4000-8000-000000000084');
update security_settings set kyc_window_hours = 1 where id;
reset role;
select is((select kyc_window_hours from security_settings where id), 24,
          'orders staff (no settings permission) cannot change the window');
select pg_temp.as_user('10000000-0000-4000-8000-000000000081');
select is_empty($$ select kyc_window_hours from security_settings $$,
                'customers cannot read the window (security_settings is settings-only)');
reset role;
select pg_temp.as_user('10000000-0000-4000-8000-000000000083');
update security_settings set kyc_window_hours = 48 where id;
select throws_ok($$ update security_settings set kyc_window_hours = 721 where id $$,
                 '23514', null, 'window is bounded (0 to 720 hours)');
reset role;
select is((select kyc_window_hours from security_settings where id), 48, 'settings staff changed the window to 48 h');
select results_eq(
  $$ select actor_id, old_data ->> 'kyc_window_hours', new_data ->> 'kyc_window_hours'
       from audit_logs where action = 'security_settings.update' and new_data ->> 'kyc_window_hours' = '48' $$,
  $$ values ('10000000-0000-4000-8000-000000000083'::uuid, '24', '48') $$,
  'the change is in the audit log with who, before and after');
update security_settings set kyc_window_hours = 24 where id;
update app_settings set kyc_threshold_usd = 100 where id;

-- 8. Cart: RLS and validation ------------------------------------------------------
select pg_temp.as_user('10000000-0000-4000-8000-000000000081');
select lives_ok(
  $$ insert into cart_items (variant_id, quantity, fulfillment_data)
     values ('00000000-0000-4000-c000-000000000001', 2, '{"player_id":"123456"}'),
            ('00000000-0000-4000-c000-000000000004', 1, '{"player_id":"1234567","server":"mena"}') $$,
  'a customer adds lines to their own cart');
select is((select user_id::text from cart_items limit 1), '10000000-0000-4000-8000-000000000081',
          'the line belongs to the caller (default auth.uid())');
select throws_ok(
  $$ insert into cart_items (user_id, variant_id, quantity, fulfillment_data)
     values ('10000000-0000-4000-8000-000000000082', '00000000-0000-4000-c000-000000000001', 1, '{"player_id":"123456"}') $$,
  '42501', null, 'cannot put a line into another customer''s cart');
select throws_ok(
  $$ insert into cart_items (variant_id, quantity, fulfillment_data)
     values ('00000000-0000-4000-c000-000000000001', 6, '{"player_id":"123456"}') $$,
  'P0001', 'INVALID_QUANTITY', 'quantity above the variant maximum is refused in the cart');
select throws_like(
  $$ insert into cart_items (variant_id, quantity, fulfillment_data)
     values ('00000000-0000-4000-c000-000000000001', 1, '{"player_id":"12"}') $$,
  'FULFILLMENT_INVALID%', 'invalid fulfillment data is refused in the cart');
select throws_ok(
  $$ update cart_items set variant_id = '00000000-0000-4000-c000-000000000002' $$,
  '42501', null, 'the variant of a line cannot be swapped (only quantity and data are updatable)');
select throws_ok(
  $$ insert into cart_items (variant_id, quantity, price_usd) values ('00000000-0000-4000-c000-000000000001', 1, 0.01) $$,
  '42703', null, 'a cart line has no price column to tamper with');
reset role;
update product_variants set is_active = false where id = '00000000-0000-4000-c000-000000000005';
select pg_temp.as_user('10000000-0000-4000-8000-000000000081');
select throws_ok(
  $$ insert into cart_items (variant_id, quantity, fulfillment_data)
     values ('00000000-0000-4000-c000-000000000005', 1, '{"target_phone":"+249912345678"}') $$,
  'P0001', 'VARIANT_UNAVAILABLE', 'a hidden variant cannot be added to the cart');
reset role;
update product_variants set is_active = true where id = '00000000-0000-4000-c000-000000000005';

select pg_temp.as_user('10000000-0000-4000-8000-000000000082');
select is_empty($$ select id from cart_items $$, 'another customer sees none of these lines');
select is((select count(*)::int from cart_items where user_id = '10000000-0000-4000-8000-000000000081'), 0,
          'and cannot read them by filtering on the owner either');
reset role;
select pg_temp.as_user('10000000-0000-4000-8000-000000000084');
select is_empty($$ select id from cart_items $$, 'orders staff have no access to carts');
reset role;
set local role anon;
select throws_ok($$ select id from cart_items $$, '42501', null, 'anon has no access to carts');
reset role;

insert into cart_items (user_id, variant_id, quantity, fulfillment_data)
select '10000000-0000-4000-8000-000000000082', '00000000-0000-4000-c000-000000000001', 1, '{"player_id":"123456"}'
  from generate_series(1, 20);
select throws_ok(
  $$ insert into cart_items (user_id, variant_id, quantity, fulfillment_data)
     values ('10000000-0000-4000-8000-000000000082', '00000000-0000-4000-c000-000000000001', 1, '{"player_id":"123456"}') $$,
  'P0001', 'CART_FULL', 'a cart holds at most 20 lines');
delete from cart_items where user_id = '10000000-0000-4000-8000-000000000082';

-- 9. my_cart and checkout ----------------------------------------------------------
update app_settings set usd_sdg_rate = 2600 where id;
select pg_temp.as_user('10000000-0000-4000-8000-000000000081');
select results_eq(
  $$ select (my_cart() ->> 'total_sdg')::numeric, jsonb_array_length(my_cart() -> 'lines'),
            (my_cart() ->> 'kyc_needed')::boolean $$,
  $$ values (8320::numeric, 2, false) $$,
  'my_cart: the live total of the lines (ceil(2.20 × 2600) + ceil(1.00 × 2600) = 5720 + 2600)');
select results_eq(
  $$ select checkout_cart(gen_random_uuid(), 100) ->> 'status', checkout_cart(gen_random_uuid(), 100) ->> 'total_sdg' $$,
  $$ values ('price_changed'::text, '8320'::text) $$,
  'checkout with a forged lower total: price_changed with the real total');
select is((select count(*)::int from orders where user_id = '10000000-0000-4000-8000-000000000081'), 2,
          'and no order was created (still the two from sections 1 and 2)');
create temp table co on commit drop as select checkout_cart('30000000-0000-4000-8000-000000000001', 8320) as r;
select is((select r ->> 'status' from co), 'created', 'checkout at the shown total creates the order');
select results_eq(
  $$ select o.total_sdg, (select count(*)::int from order_items i where i.order_id = o.id)
       from orders o where o.id = ((select r ->> 'id' from co))::uuid $$,
  $$ values (8320::numeric, 2) $$,
  'one order with both cart lines');
select is_empty($$ select id from cart_items $$, 'the cart is empty after checkout');
select is(checkout_cart('30000000-0000-4000-8000-000000000001', 8320) ->> 'reference',
          (select r ->> 'reference' from co), 'the same checkout again returns the same order (idempotent)');
select is(checkout_cart(gen_random_uuid(), 0) ->> 'reason', 'cart_empty', 'checkout of an empty cart creates nothing');

-- Hidden variant in the cart: refused with the line named, nothing created.
insert into cart_items (variant_id, quantity, fulfillment_data)
values ('00000000-0000-4000-c000-000000000001', 1, '{"player_id":"123456"}');
reset role;
update product_variants set is_active = false where id = '00000000-0000-4000-c000-000000000001';
select pg_temp.as_user('10000000-0000-4000-8000-000000000081');
select results_eq(
  $$ select (my_cart() -> 'lines' -> 0 ->> 'available')::boolean, (my_cart() ->> 'unavailable')::int,
            (my_cart() ->> 'total_sdg')::numeric $$,
  $$ values (false, 1, 0::numeric) $$,
  'my_cart marks the hidden line unavailable and leaves it out of the total');
select results_eq(
  $$ select r ->> 'reason', r -> 'lines' ->> 0 from (select checkout_cart(gen_random_uuid(), 2860) as r) x $$,
  $$ select 'variant_unavailable'::text, (select id::text from cart_items limit 1) $$,
  'hidden variant in the cart: checkout refused and the line is named');
select is((select count(*)::int from orders where user_id = '10000000-0000-4000-8000-000000000081'), 3,
          'no order created for the hidden variant (still three)');
reset role;
update product_variants set is_active = true where id = '00000000-0000-4000-c000-000000000001';

-- KYC on the cart total through checkout.
update app_settings set kyc_threshold_usd = 3 where id;
update security_settings set kyc_window_hours = 0 where id;
select pg_temp.as_user('10000000-0000-4000-8000-000000000081');
insert into cart_items (variant_id, quantity, fulfillment_data)
values ('00000000-0000-4000-c000-000000000001', 2, '{"player_id":"123456"}');
select is((my_cart() ->> 'kyc_needed')::boolean, true, 'my_cart says the total needs identity verification');
select is(checkout_cart(gen_random_uuid(), 8580) ->> 'reason', 'kyc_required',
          'checkout of 1.10 + 2.20 USD lines with a 3 USD threshold → kyc_required');
select is((select count(*)::int from cart_items), 2, 'the cart is kept when checkout is refused');
reset role;

select * from finish();
rollback;
