-- Phase 10b: admin access needs aal2 (an authenticator code), and the About /
-- Terms / Privacy pages follow the FAQ permission model.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(24);

insert into auth.users (id, instance_id, aud, role, phone, phone_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('10000000-0000-4000-8000-000000000071', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', '249911000071', now(), '{"signup_verified":"otp"}', '{}', now(), now()),
  ('10000000-0000-4000-8000-000000000072', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', '249911000072', now(), '{"signup_verified":"otp"}', '{}', now(), now()),
  ('10000000-0000-4000-8000-000000000073', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', '249911000073', now(), '{"signup_verified":"otp"}', '{}', now(), now());
-- 71: settings staff; 72: orders-only staff; 73: customer.
insert into admins (user_id) values
  ('10000000-0000-4000-8000-000000000071'), ('10000000-0000-4000-8000-000000000072');
insert into admin_permissions (admin_id, permission) values
  ('10000000-0000-4000-8000-000000000071', 'settings'),
  ('10000000-0000-4000-8000-000000000072', 'orders');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values ('20000000-0000-4000-8000-000000000072', '10000000-0000-4000-8000-000000000072',
        'phone', 'totp', 'verified', now(), now(), 'SECRET');
insert into auth.sessions (id, user_id, created_at, updated_at)
values ('30000000-0000-4000-8000-000000000072', '10000000-0000-4000-8000-000000000072', now(), now());

-- 1. The assurance gate -------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000071","role":"authenticated","aal":"aal1"}';
select is(private.is_admin(), false, 'staff with a password-only session (aal1) is not an admin to the database');
select is(private.has_permission('settings'), false, 'aal1: no permission either');
select is((select count(*) from security_settings), 0::bigint, 'aal1: settings-only table reads nothing');
select throws_ok($$ select * from admin_orders() $$, '42501', 'FORBIDDEN',
  'aal1: admin functions raise');

set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000071","role":"authenticated"}';
select is(private.is_admin(), false, 'no aal claim at all: not an admin');

set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000071","role":"authenticated","aal":"aal2"}';
select is(private.is_admin(), true, 'the same staff member after an authenticator code (aal2) is an admin');
select is(private.has_permission('settings'), true, 'aal2: their permission applies');
select is((select count(*) from security_settings), 1::bigint, 'aal2: the settings row is visible');

set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000073","role":"authenticated","aal":"aal2"}';
select is(private.is_admin(), false, 'a customer is never an admin, whatever the aal');

-- 2. TOTP label only for active staff ----------------------------------------
select throws_ok($$ select staff_totp_label() $$, '42501', 'FORBIDDEN',
  'a customer cannot get a TOTP label (no email is written for customers)');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000071","role":"authenticated","aal":"aal1"}';
select is(staff_totp_label(), '249911000071@staff.invalid',
  'staff (even at aal1, before enrolling) get the reserved .invalid label');

-- 3. Owner reset and break glass ---------------------------------------------
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000071","role":"authenticated","aal":"aal2"}';
select throws_ok($$ select admin_reset_mfa('10000000-0000-4000-8000-000000000072') $$,
  '42501', 'FORBIDDEN', 'only the owner can reset another staff member''s 2FA');
reset role;
select is((select count(*) from auth.mfa_factors where user_id = '10000000-0000-4000-8000-000000000072'),
  1::bigint, 'the factor is still there after the refused reset');
select is(has_function_privilege('authenticated', 'private.break_glass_reset_mfa(text)', 'execute'),
  false, 'break glass is not callable through the API');
select is(has_function_privilege('anon', 'public.admin_reset_mfa(uuid)', 'execute'),
  false, 'anon cannot call the reset');
select is(private.break_glass_reset_mfa('+249911000072'), 1,
  'break glass (database session) removes the factor, by phone with or without +');
select is((select count(*) from auth.sessions where user_id = '10000000-0000-4000-8000-000000000072'),
  0::bigint, 'and ends their sessions');
select is((select action from audit_logs where entity_id = '10000000-0000-4000-8000-000000000072'
           order by id desc limit 1), 'admins.mfa_break_glass', 'and is audited');

-- 4. Site pages: FAQ permission model -----------------------------------------
select set_eq($$ select slug from site_pages $$, array['about', 'terms', 'privacy'],
  'exactly the three pages exist');
set local request.jwt.claims = '{"role":"anon"}';
set local role anon;
select is((select count(*) from site_pages), 0::bigint, 'anon sees no draft page');
reset role;
update site_pages set title_en = 'About', body_en = 'We sell top-ups.', is_published = true where slug = 'about';
set local role anon;
select is((select count(*) from site_pages), 1::bigint, 'anon sees the published page only');
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000072","role":"authenticated","aal":"aal2"}';
update site_pages set body_en = 'hacked' where slug = 'about';
select is((select body_en from site_pages where slug = 'about'), 'We sell top-ups.',
  'staff without the settings permission cannot edit (RLS: 0 rows)');
select throws_ok($$ insert into site_pages (slug) values ('about') $$, '42501', null,
  'nobody inserts pages through the API');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000071","role":"authenticated","aal":"aal2"}';
select throws_ok($$ update site_pages set title_ar = null, title_en = null where slug = 'about' $$,
  '23514', null, 'a published page cannot lose its title (CHECK)');

select * from finish();
rollback;
