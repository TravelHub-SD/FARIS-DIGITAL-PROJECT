-- Storefront data (Stage 3): category sections, promo banners, "New" badge
-- and compare-at price. Who reads and writes what; compare-at is display only.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(22);

insert into auth.users (id, instance_id, aud, role, email, phone, phone_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('10000000-0000-4000-8000-000000000091', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sf-customer@test.local', '249911000091', now(),
   '{"signup_verified":"otp"}', '{}', now(), now()),
  ('10000000-0000-4000-8000-000000000092', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sf-products@test.local', '249911000092', now(),
   '{"signup_verified":"otp"}', '{}', now(), now()),
  ('10000000-0000-4000-8000-000000000093', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sf-settings@test.local', '249911000093', now(),
   '{"signup_verified":"otp"}', '{}', now(), now());
insert into admins (user_id) values ('10000000-0000-4000-8000-000000000092'), ('10000000-0000-4000-8000-000000000093');
insert into admin_permissions (admin_id, permission) values
  ('10000000-0000-4000-8000-000000000092', 'products'),
  ('10000000-0000-4000-8000-000000000093', 'settings');

create function pg_temp.as_user(p_id text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
end;
$$;

insert into category_sections (id, name_ar, is_active) values
  ('20000000-0000-4000-8000-000000000091', 'قسم مخفي', false);
insert into promo_banners (id, title_ar, is_active) values
  ('20000000-0000-4000-8000-000000000092', 'شريحة مخفية', false);

-- 1. Sections -----------------------------------------------------------------
set local role anon;
select is((select count(*)::int from category_sections), 3, 'anon sees the active sections');
select is_empty($$ select id from category_sections where not is_active $$, 'anon does not see a hidden section');
select throws_ok($$ insert into category_sections (name_ar) values ('x') $$, '42501', null,
                 'anon cannot create a section');
reset role;

select pg_temp.as_user('10000000-0000-4000-8000-000000000091');
select throws_ok($$ insert into category_sections (name_ar) values ('x') $$, '42501', null,
                 'a customer cannot create a section');
update category_sections set name_ar = 'مخترق' where name_en = 'Game top-ups';
reset role;
select is((select name_ar from category_sections where name_en = 'Game top-ups'), 'شحن الألعاب',
          'a customer cannot rename a section');

select pg_temp.as_user('10000000-0000-4000-8000-000000000093');
select throws_ok($$ insert into category_sections (name_ar) values ('x') $$, '42501', null,
                 'settings staff (no products permission) cannot create a section');
reset role;

select pg_temp.as_user('10000000-0000-4000-8000-000000000092');
select is((select count(*)::int from category_sections), 4, 'products staff see hidden sections too');
select lives_ok($$ insert into category_sections (name_ar, name_en) values ('بطاقات الألعاب', 'Game cards') $$,
                'products staff create a section');
select lives_ok($$ update categories set section_id = (select id from category_sections where name_en = 'Game cards')
                    where slug = 'games' $$, 'products staff assign a category to a section');
reset role;
select is((select action || ':' || coalesce(new_data ->> 'name_en', '') from audit_logs
            where entity_type = 'category_sections' and new_data ->> 'name_en' = 'Game cards'),
          'category_sections.insert:Game cards', 'section changes are audited');
delete from category_sections where name_en = 'Game cards';
select is((select section_id from categories where slug = 'games'), null::uuid,
          'deleting a section leaves its categories unassigned');

-- 2. Banners ------------------------------------------------------------------
set local role anon;
select is((select count(*)::int from promo_banners), 2, 'anon sees the active slides');
select is_empty($$ select id from promo_banners where not is_active $$, 'anon does not see a hidden slide');
reset role;

select pg_temp.as_user('10000000-0000-4000-8000-000000000092');
select throws_ok($$ insert into promo_banners (title_ar) values ('x') $$, '42501', null,
                 'products staff (no settings permission) cannot add a slide');
reset role;

select pg_temp.as_user('10000000-0000-4000-8000-000000000093');
select lives_ok($$ insert into promo_banners (title_ar, link) values ('عرض', '/c/games') $$,
                'settings staff add a slide');
select throws_ok($$ insert into promo_banners (title_ar, link) values ('x', 'javascript:alert(1)') $$,
                 '23514', null, 'a slide link must be a site path or https');
select throws_ok($$ insert into promo_banners (link) values ('/c/games') $$,
                 '23514', null, 'a slide needs a title or an image');
reset role;

-- 3. "New" and compare-at: display only ---------------------------------------
select is((select compare_at_sdg(v) from product_variants v where id = '00000000-0000-4000-c000-000000000003'),
          15340::numeric, 'compare-at shown in SDG at the current rate (5.90 × 2600)');
update product_variants set compare_at_price_usd = 5.00 where id = '00000000-0000-4000-c000-000000000003';
select is((select compare_at_sdg(v) from product_variants v where id = '00000000-0000-4000-c000-000000000003'),
          null::numeric, 'a compare-at at or below the price is not shown (no fake discount)');
update product_variants set compare_at_price_usd = 99.00 where id = '00000000-0000-4000-c000-000000000003';
create temp table o on commit drop as
  select (private.insert_order('10000000-0000-4000-8000-000000000091',
    '[{"variant_id":"00000000-0000-4000-c000-000000000003","quantity":1,"fulfillment_data":{"player_id":"123456"}}]',
    gen_random_uuid())).id;
select results_eq(
  $$ select i.unit_price_usd, o.total_sdg
       from orders o join order_items i on i.order_id = o.id
      where o.id = (select id from pg_temp.o) $$,
  $$ values (5.20::numeric, 13520::numeric) $$,
  'an order is charged the price, never the compare-at price');

select pg_temp.as_user('10000000-0000-4000-8000-000000000091');
update products set is_new = false where slug = 'free-fire-diamonds';
reset role;
select is((select is_new from products where slug = 'free-fire-diamonds'), true,
          'a customer cannot change the "New" flag');
select pg_temp.as_user('10000000-0000-4000-8000-000000000092');
update products set is_new = false where slug = 'free-fire-diamonds';
reset role;
select is((select is_new from products where slug = 'free-fire-diamonds'), false,
          'products staff change the "New" flag');

select * from finish();
rollback;
