-- Brand renamed to "Fast Store" (Hassan, 2026-11-21; decisions.md).
-- The seller name printed on NEW invoices comes from app_settings; issued
-- invoices keep the name in their snapshot and are not touched here.
-- The settings row changes only while it still holds the old default, so a
-- name set in the dashboard is never overwritten.

alter table public.app_settings
  alter column business_name_ar set default 'Fast Store',
  alter column business_name_en set default 'Fast Store';

update public.app_settings
   set business_name_ar = 'Fast Store'
 where id and business_name_ar = 'فارس ديجيتال';

update public.app_settings
   set business_name_en = 'Fast Store'
 where id and business_name_en = 'Faris Digital';
