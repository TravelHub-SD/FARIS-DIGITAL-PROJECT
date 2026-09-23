-- DEVELOPMENT SEED ONLY. Run by `supabase db reset` on the local stack.
-- Never run against production (CLAUDE.md rule 8). Values are placeholders,
-- not client data: the real rate, threshold and catalog are set by the owner.

update public.app_settings
   set usd_sdg_rate = 2600.0000,
       kyc_threshold_usd = 100.00
 where id;

insert into public.categories (id, slug, name_ar, name_en, sort_order) values
  ('00000000-0000-4000-a000-000000000001', 'games', 'شحن الألعاب', 'Game top-ups', 1),
  ('00000000-0000-4000-a000-000000000002', 'starlink', 'ستارلينك', 'Starlink', 2);

insert into public.products (id, category_id, slug, name_ar, name_en, sort_order) values
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000001',
   'pubg-uc', 'شدات ببجي', 'PUBG UC', 1),
  ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000002',
   'starlink-subscription', 'اشتراك ستارلينك', 'Starlink subscription', 1);

insert into public.product_variants (id, product_id, name_ar, name_en, price_usd, max_quantity, required_fields) values
  ('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-b000-000000000001',
   '60 شدة', '60 UC', 1.10, 5,
   '[{"key":"player_id","type":"text","label_ar":"رقم اللاعب","label_en":"Player ID","required":true,"max_length":20}]'),
  ('00000000-0000-4000-c000-000000000002', '00000000-0000-4000-b000-000000000002',
   'شهر واحد', 'One month', 120.00, 1,
   '[{"key":"account_email","type":"email","label_ar":"بريد الحساب","label_en":"Account email","required":true}]');
