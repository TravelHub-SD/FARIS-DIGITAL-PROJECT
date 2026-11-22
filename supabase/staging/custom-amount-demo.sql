-- STAGING DEMO DATA ONLY (faris-digital-staging). Never run against
-- production (CLAUDE.md rule 8). Idempotent: safe to run again.
--
-- Custom-amount products (item 6, decisions.md 2026-11-21) for the client to
-- try: the five currencies he named, with PLACEHOLDER rates (SDG per unit;
-- USD always follows the store's USD rate), and one product, "Pay a bill
-- with Visa", with placeholder limits and a placeholder fee (1.5% + 200
-- SDG) so the calculator shows a fee line. Every value is a setting: the
-- client changes them on the Currencies page and the product's page.

insert into public.currencies (code, name_ar, name_en, symbol, sdg_rate, sort_order) values
  ('USD', 'دولار أمريكي', 'US dollar', '$', 1, 1),
  ('EUR', 'يورو', 'Euro', '€', 2800.0000, 2),
  ('SAR', 'ريال سعودي', 'Saudi riyal', 'ر.س', 690.0000, 3),
  ('AED', 'درهم إماراتي', 'UAE dirham', 'د.إ', 705.0000, 4),
  ('GBP', 'جنيه إسترليني', 'Pound sterling', '£', 3300.0000, 5)
on conflict (code) do nothing;

insert into public.categories (slug, name_ar, name_en, description_ar, description_en, sort_order)
values ('bill-payments', 'دفع الفواتير', 'Bill payments',
        'ندفع عنك فواتير ومشتريات بالعملة الأجنبية ببطاقة فيزا.',
        'We pay your foreign-currency bills and purchases with a Visa card.', 90)
on conflict (slug) do nothing;

insert into public.products (category_id, slug, name_ar, name_en, description_ar, description_en, kind, is_new)
select c.id, 'pay-bill-visa', 'ادفع فاتورة بالفيزا', 'Pay a bill with Visa',
       'أرسل لنا رابط الفاتورة أو الموقع، واكتب المبلغ بعملتها، وندفعها ببطاقة فيزا. يظهر لك المبلغ بالجنيه السوداني قبل الطلب.',
       'Send us the invoice link or the website, enter the amount in its currency, and we pay it with a Visa card. You see the price in Sudanese pounds before you order.',
       'custom_amount', true
  from public.categories c where c.slug = 'bill-payments'
on conflict (slug) do nothing;

update public.custom_amount_products s
   set amount_decimals = 2,
       fee_percent = 1.5,
       fee_fixed_sdg = 200,
       required_fields = '[
         {"key":"bill_link","type":"text","label_ar":"رابط الفاتورة","label_en":"Invoice link","required":true,"min_length":5,"max_length":200},
         {"key":"website","type":"text","label_ar":"الموقع","label_en":"Website","required":false,"max_length":200},
         {"key":"email","type":"email","label_ar":"البريد الإلكتروني للفاتورة","label_en":"Email on the bill","required":true}
       ]'
  from public.products p
 where p.id = s.product_id and p.slug = 'pay-bill-visa';

insert into public.custom_amount_currencies (product_id, currency_code, min_amount, max_amount, sort_order)
select p.id, v.code, v.min, v.max, v.sort
  from public.products p,
       (values ('USD', 5, 1000, 1), ('EUR', 5, 1000, 2), ('SAR', 20, 4000, 3),
               ('AED', 20, 4000, 4), ('GBP', 5, 800, 5)) as v(code, min, max, sort)
 where p.slug = 'pay-bill-visa'
on conflict (product_id, currency_code) do nothing;
