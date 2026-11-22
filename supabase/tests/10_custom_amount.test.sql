-- Custom-amount products (item 6, decisions.md 2026-11-21): the structural
-- guarantees under the triggers. Even with every trigger switched off
-- (session_replication_role = replica, which also skips foreign keys), the
-- CHECK constraints refuse an order line whose SDG total is not
-- amount × rate + fee, and a line that is both a package and an amount.
-- Plus RLS and grants on the new tables.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(16);

-- 1. RLS and grants ------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.currencies'::regclass),
          'currencies: RLS on');
select ok((select relrowsecurity from pg_class where oid = 'public.custom_amount_products'::regclass),
          'custom_amount_products: RLS on');
select ok((select relrowsecurity from pg_class where oid = 'public.custom_amount_currencies'::regclass),
          'custom_amount_currencies: RLS on');
select ok(not has_column_privilege('authenticated', 'public.currencies', 'code', 'update'),
          'a currency code never changes (no update grant)');
select ok(not has_table_privilege('authenticated', 'public.currencies', 'delete'),
          'currencies are disabled, never deleted');
select ok(not has_column_privilege('authenticated', 'public.products', 'kind', 'update')
          and has_column_privilege('authenticated', 'public.products', 'kind', 'insert'),
          'the product kind is chosen at creation only');
select ok(not has_table_privilege('authenticated', 'public.custom_amount_products', 'insert'),
          'settings rows are created by the database with the product (safe defaults)');
select ok(not has_column_privilege('authenticated', 'public.cart_items', 'amount', 'update')
          and not has_column_privilege('authenticated', 'public.cart_items', 'currency_code', 'update'),
          'a cart line keeps its amount and currency once added');
select ok(not has_table_privilege('authenticated', 'public.order_items', 'insert'),
          'nobody inserts order lines directly');
select policies_are('public', 'currencies',
  array['currencies_select', 'currencies_insert', 'currencies_update']);

-- 2. The snapshot formulas hold with every trigger off --------------------------
set local session_replication_role = replica;

select lives_ok($$
  insert into order_items (order_id, line_no, variant_id, kind, product_id, amount, currency_code,
                           currency_rate_sdg, fee_percent, fee_fixed_sdg, fee_sdg, quantity,
                           unit_price_usd, line_total_usd, usd_sdg_rate, line_total_sdg)
  values (gen_random_uuid(), 1, null, 'custom_amount', gen_random_uuid(), 56, 'EUR',
          3050, 1.5, 200, 2762, 1, 66.76, 66.76, 2600, 173562)
$$, 'a consistent line: 56 × 3,050 = 170,800; 1.5% = 2,562 + 200 = 2,762; ceil = 173,562; 66.76 USD');

select throws_ok($$
  insert into order_items (order_id, line_no, variant_id, kind, product_id, amount, currency_code,
                           currency_rate_sdg, fee_percent, fee_fixed_sdg, fee_sdg, quantity,
                           unit_price_usd, line_total_usd, usd_sdg_rate, line_total_sdg)
  values (gen_random_uuid(), 1, null, 'custom_amount', gen_random_uuid(), 56, 'EUR',
          3050, 1.5, 200, 2762, 1, 0.01, 0.01, 2600, 1)
$$, '23514', null, 'a forged SDG total (1 instead of 173,562) violates the formula CHECK');

select throws_ok($$
  insert into order_items (order_id, line_no, variant_id, kind, product_id, amount, currency_code,
                           currency_rate_sdg, fee_percent, fee_fixed_sdg, fee_sdg, quantity,
                           unit_price_usd, line_total_usd, usd_sdg_rate, line_total_sdg)
  values (gen_random_uuid(), 1, null, 'custom_amount', gen_random_uuid(), 56, 'EUR',
          3050, 1.5, 200, 0, 1, 65.69, 65.69, 2600, 170800)
$$, '23514', null, 'a fee dropped from the line (0 instead of 2,762) violates the formula CHECK');

select throws_ok($$
  insert into order_items (order_id, line_no, variant_id, kind, product_id, amount, currency_code,
                           currency_rate_sdg, fee_percent, fee_fixed_sdg, fee_sdg, quantity,
                           unit_price_usd, line_total_usd, usd_sdg_rate, line_total_sdg)
  values (gen_random_uuid(), 1, '00000000-0000-4000-c000-000000000001', 'custom_amount',
          gen_random_uuid(), 56, 'EUR', 3050, 0, 0, 0, 1, 65.69, 65.69, 2600, 170800)
$$, '23514', null, 'a line cannot be a package and an amount at once');

select throws_ok($$
  insert into order_items (order_id, line_no, variant_id, kind, product_id, amount, currency_code,
                           currency_rate_sdg, fee_percent, fee_fixed_sdg, fee_sdg, quantity,
                           unit_price_usd, line_total_usd, usd_sdg_rate, line_total_sdg)
  values (gen_random_uuid(), 1, null, 'custom_amount', gen_random_uuid(), 56, 'EUR',
          3050, 0, 0, 0, 2, 65.69, 131.38, 2600, 341600)
$$, '23514', null, 'a custom-amount line is always quantity 1');

select throws_ok($$
  insert into cart_items (user_id, product_id, currency_code, amount, quantity, fulfillment_data)
  values (gen_random_uuid(), gen_random_uuid(), 'EUR', 56.0001, 1, '{}')
$$, '23514', null, 'a cart amount with more than 3 decimals violates the cart CHECK');

select * from finish();
rollback;
