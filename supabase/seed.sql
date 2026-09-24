-- DEVELOPMENT SEED ONLY. Run by `supabase db reset` on the local stack.
-- Never run against production (CLAUDE.md rule 8). Values are placeholders,
-- not client data: the real rate, threshold and catalog are set by the owner.
-- Some items deliberately exist in only one language to exercise fallback.

update public.app_settings
   set usd_sdg_rate = 2600.0000,
       kyc_threshold_usd = 100.00
 where id;

insert into public.categories (id, slug, name_ar, name_en, description_ar, description_en, sort_order) values
  ('00000000-0000-4000-a000-000000000001', 'games', 'شحن الألعاب', 'Game top-ups',
   'شحن فوري لألعابك المفضلة.', 'Instant top-ups for your favourite games.', 1),
  ('00000000-0000-4000-a000-000000000002', 'starlink', 'ستارلينك', 'Starlink',
   'اشتراكات وخدمات ستارلينك.', 'Starlink subscriptions and services.', 2),
  ('00000000-0000-4000-a000-000000000003', 'airtime', 'رصيد الموبايل', 'Mobile airtime',
   'رصيد لجميع الشبكات السودانية.', null, 3),
  ('00000000-0000-4000-a000-000000000004', 'subscriptions', 'اشتراكات التطبيقات', 'App subscriptions',
   null, 'Streaming and app subscriptions.', 4);

insert into public.products (id, category_id, slug, name_ar, name_en, description_ar, description_en, sort_order) values
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000001', 'pubg-uc',
   'شدات ببجي', 'PUBG UC', 'شدات ببجي موبايل تصل إلى حسابك مباشرة برقم اللاعب.',
   'PUBG Mobile UC delivered straight to your account by player ID.', 1),
  ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000002', 'starlink-subscription',
   'اشتراك ستارلينك', 'Starlink subscription', 'تجديد اشتراك ستارلينك الشهري.',
   'Monthly Starlink subscription renewal.', 1),
  ('00000000-0000-4000-b000-000000000003', '00000000-0000-4000-a000-000000000001', 'free-fire-diamonds',
   'جواهر فري فاير', 'Free Fire diamonds', 'جواهر فري فاير بمعرّف اللاعب والخادم.', null, 2),
  ('00000000-0000-4000-b000-000000000004', '00000000-0000-4000-a000-000000000003', 'zain-airtime',
   'رصيد زين', null, 'رصيد زين يُحوّل إلى الرقم الذي تحدده.', null, 1),
  ('00000000-0000-4000-b000-000000000005', '00000000-0000-4000-a000-000000000004', 'netflix-gift',
   null, 'Netflix gift card', null, 'Netflix gift card code delivered to your email.', 1);

insert into public.product_variants (id, product_id, name_ar, name_en, price_usd, max_quantity, sort_order, required_fields) values
  ('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-b000-000000000001', '60 شدة', '60 UC', 1.10, 5, 1,
   '[{"key":"player_id","type":"digits","label_ar":"رقم اللاعب","label_en":"Player ID","required":true,"min_length":5,"max_length":20}]'),
  ('00000000-0000-4000-c000-000000000003', '00000000-0000-4000-b000-000000000001', '325 شدة', '325 UC', 5.20, 5, 2,
   '[{"key":"player_id","type":"digits","label_ar":"رقم اللاعب","label_en":"Player ID","required":true,"min_length":5,"max_length":20}]'),
  ('00000000-0000-4000-c000-000000000002', '00000000-0000-4000-b000-000000000002', 'شهر واحد', 'One month', 120.00, 1, 1,
   '[{"key":"account_email","type":"email","label_ar":"بريد حساب ستارلينك","label_en":"Starlink account email","required":true},
     {"key":"kit_serial","type":"text","label_ar":"الرقم التسلسلي للجهاز","label_en":"Kit serial number","required":false,"max_length":40}]'),
  ('00000000-0000-4000-c000-000000000004', '00000000-0000-4000-b000-000000000003', '100 جوهرة', '100 diamonds', 1.00, 5, 1,
   '[{"key":"player_id","type":"digits","label_ar":"معرّف اللاعب","label_en":"Player ID","required":true,"min_length":6,"max_length":15},
     {"key":"server","type":"select","label_ar":"الخادم","label_en":"Server","required":true,
      "options":[{"value":"mena","label_ar":"الشرق الأوسط","label_en":"Middle East"},{"value":"eu","label_ar":"أوروبا","label_en":"Europe"}]}]'),
  ('00000000-0000-4000-c000-000000000005', '00000000-0000-4000-b000-000000000004', 'رصيد 5000 جنيه', null, 2.00, 3, 1,
   '[{"key":"target_phone","type":"phone","label_ar":"الرقم المراد شحنه","required":true}]'),
  ('00000000-0000-4000-c000-000000000006', '00000000-0000-4000-b000-000000000005', null, '$25 card', 27.00, 2, 1,
   '[{"key":"delivery_email","type":"email","label_en":"Email for the code","required":true}]');
