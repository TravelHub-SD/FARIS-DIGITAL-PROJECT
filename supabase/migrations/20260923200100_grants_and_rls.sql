-- Grants + Row Level Security for every table.
--
-- Threat model: the publishable (anon) key is public, so any visitor or
-- signed-in customer can call PostgREST directly with whatever body they like.
-- Therefore:
--   * Start from ZERO privileges (Supabase grants ALL on public tables to
--     anon/authenticated by default) and grant the minimum per table.
--   * Customers get no INSERT/UPDATE on money or state tables. Those change
--     only through SECURITY DEFINER functions or the server (service_role),
--     and the database derives every money field itself (see orders triggers).
--   * Column-level grants limit what a permitted UPDATE may touch, because RLS
--     is row-level only.
--   * Admin access always goes through private.has_permission()/is_owner().

-- 1. Remove default privileges ------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all sequences in schema private from public, anon, authenticated;

-- Future objects start closed too.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema private
  revoke execute on functions from public, anon, authenticated;
-- Per-schema default privileges cannot remove Postgres' GLOBAL default
-- (EXECUTE to PUBLIC on every new function), so revoke it globally too.
-- Without this, any future function in `public` would be callable via /rpc.
alter default privileges for role postgres revoke execute on functions from public;

-- 2. Enable RLS everywhere (private tables too: defence in depth) -------------
alter table public.profiles enable row level security;
alter table public.admins enable row level security;
alter table public.admin_permissions enable row level security;
alter table public.app_settings enable row level security;
alter table public.security_settings enable row level security;
alter table public.bank_accounts enable row level security;
alter table public.faqs enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.kyc_submissions enable row level security;
alter table public.order_statuses enable row level security;
alter table public.order_status_transitions enable row level security;
alter table public.orders enable row level security;
alter table public.order_status_history enable row level security;
alter table public.order_internal_notes enable row level security;
alter table public.payment_receipts enable row level security;
alter table public.invoices enable row level security;
alter table public.comments enable row level security;
alter table public.message_logs enable row level security;
alter table private.invoice_counters enable row level security;
alter table private.otp_codes enable row level security;
alter table private.rate_limit_events enable row level security;

-- 3. Per-table grants and policies ---------------------------------------------

-- profiles: customers read/edit only their own name and locale.
-- kyc_status, phone, is_blocked are NOT granted: they change only via
-- definer functions (KYC review, OTP flow, admin block action).
grant select on public.profiles to authenticated;
grant update (full_name, locale) on public.profiles to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_select_staff on public.profiles
  for select to authenticated
  using (
    (select private.has_permission('customers'))
    or (select private.has_permission('kyc'))
    or (select private.has_permission('orders'))
  );

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- admins / admin_permissions: owner manages; an admin can see its own rows.
grant select, insert, update, delete on public.admins to authenticated;
grant select, insert, delete on public.admin_permissions to authenticated;

create policy admins_select on public.admins
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_owner()));
create policy admins_insert_owner on public.admins
  for insert to authenticated
  with check ((select private.is_owner()) and not is_owner);
create policy admins_update_owner on public.admins
  for update to authenticated
  using ((select private.is_owner()))
  with check ((select private.is_owner()));
create policy admins_delete_owner on public.admins
  for delete to authenticated
  using ((select private.is_owner()));

create policy admin_permissions_select on public.admin_permissions
  for select to authenticated
  using (admin_id = (select auth.uid()) or (select private.is_owner()));
create policy admin_permissions_insert_owner on public.admin_permissions
  for insert to authenticated
  with check ((select private.is_owner()));
create policy admin_permissions_delete_owner on public.admin_permissions
  for delete to authenticated
  using ((select private.is_owner()));

-- app_settings: public read (needed to show SDG prices and contacts);
-- only settings admins update, and only the listed columns.
grant select on public.app_settings to anon, authenticated;
grant update (
  usd_sdg_rate, kyc_threshold_usd, contact_phone, contact_whatsapp, contact_email,
  address_ar, address_en, social_links, banner_title_ar, banner_title_en,
  banner_image_path, banner_link, banner_is_active, logo_path
) on public.app_settings to authenticated;

create policy app_settings_select_all on public.app_settings
  for select to anon, authenticated
  using (true);
create policy app_settings_update_settings on public.app_settings
  for update to authenticated
  using ((select private.has_permission('settings')))
  with check ((select private.has_permission('settings')));

-- security_settings: settings admins only.
grant select on public.security_settings to authenticated;
grant update (otp_login_policy, allowed_phone_country_codes, otp_daily_budget)
  on public.security_settings to authenticated;

create policy security_settings_select on public.security_settings
  for select to authenticated
  using ((select private.has_permission('settings')));
create policy security_settings_update on public.security_settings
  for update to authenticated
  using ((select private.has_permission('settings')))
  with check ((select private.has_permission('settings')));

-- bank_accounts, faqs: public read of active/published rows; settings admins write.
grant select on public.bank_accounts to anon, authenticated;
grant insert, update, delete on public.bank_accounts to authenticated;

create policy bank_accounts_select on public.bank_accounts
  for select to anon, authenticated
  using (is_active or (select private.has_permission('settings')));
create policy bank_accounts_insert on public.bank_accounts
  for insert to authenticated
  with check ((select private.has_permission('settings')));
create policy bank_accounts_update on public.bank_accounts
  for update to authenticated
  using ((select private.has_permission('settings')))
  with check ((select private.has_permission('settings')));
create policy bank_accounts_delete on public.bank_accounts
  for delete to authenticated
  using ((select private.has_permission('settings')));

grant select on public.faqs to anon, authenticated;
grant insert, update, delete on public.faqs to authenticated;

create policy faqs_select on public.faqs
  for select to anon, authenticated
  using (is_published or (select private.has_permission('settings')));
create policy faqs_insert on public.faqs
  for insert to authenticated
  with check ((select private.has_permission('settings')));
create policy faqs_update on public.faqs
  for update to authenticated
  using ((select private.has_permission('settings')))
  with check ((select private.has_permission('settings')));
create policy faqs_delete on public.faqs
  for delete to authenticated
  using ((select private.has_permission('settings')));

-- Catalog: public read of visible rows; products admins write.
-- Sub-selects on parent tables are themselves filtered by the parent's RLS.
grant select on public.categories, public.products, public.product_variants to anon, authenticated;
grant insert, update, delete on public.categories, public.product_variants to authenticated;
grant delete on public.products to authenticated;
grant insert (
  category_id, slug, name_ar, name_en, description_ar, description_en,
  image_path, sort_order, is_active, archived_at
) on public.products to authenticated;
-- completed_orders_count is maintained by the order trigger, not by admins.
grant update (
  category_id, slug, name_ar, name_en, description_ar, description_en,
  image_path, sort_order, is_active, archived_at
) on public.products to authenticated;

create policy categories_select on public.categories
  for select to anon, authenticated
  using ((is_active and archived_at is null) or (select private.has_permission('products')));
create policy categories_insert on public.categories
  for insert to authenticated
  with check ((select private.has_permission('products')));
create policy categories_update on public.categories
  for update to authenticated
  using ((select private.has_permission('products')))
  with check ((select private.has_permission('products')));
create policy categories_delete on public.categories
  for delete to authenticated
  using ((select private.has_permission('products')));

create policy products_select on public.products
  for select to anon, authenticated
  using (
    (is_active and archived_at is null
      and exists (select 1 from public.categories c where c.id = category_id))
    or (select private.has_permission('products'))
  );
create policy products_insert on public.products
  for insert to authenticated
  with check ((select private.has_permission('products')));
create policy products_update on public.products
  for update to authenticated
  using ((select private.has_permission('products')))
  with check ((select private.has_permission('products')));
create policy products_delete on public.products
  for delete to authenticated
  using ((select private.has_permission('products')));

create policy product_variants_select on public.product_variants
  for select to anon, authenticated
  using (
    (is_active and archived_at is null
      and exists (select 1 from public.products p where p.id = product_id))
    or (select private.has_permission('products'))
  );
create policy product_variants_insert on public.product_variants
  for insert to authenticated
  with check ((select private.has_permission('products')));
create policy product_variants_update on public.product_variants
  for update to authenticated
  using ((select private.has_permission('products')))
  with check ((select private.has_permission('products')));
create policy product_variants_delete on public.product_variants
  for delete to authenticated
  using ((select private.has_permission('products')));

-- KYC: read own or reviewer. Writes only via definer functions (Phase 3).
grant select on public.kyc_submissions to authenticated;

create policy kyc_submissions_select on public.kyc_submissions
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.has_permission('kyc')));

-- Order status reference data: readable by everyone, changed only by migrations.
grant select on public.order_statuses, public.order_status_transitions to anon, authenticated;

create policy order_statuses_select on public.order_statuses
  for select to anon, authenticated using (true);
create policy order_status_transitions_select on public.order_status_transitions
  for select to anon, authenticated using (true);

-- Orders: read own or orders admin. No INSERT/UPDATE/DELETE grant at all:
-- creation is a definer function (Phase 5), status via change_order_status().
grant select on public.orders to authenticated;

create policy orders_select on public.orders
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.has_permission('orders')));

-- Status history: visible wherever the order is visible (orders RLS applies).
grant select on public.order_status_history to authenticated;

create policy order_status_history_select on public.order_status_history
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));

-- Internal notes: orders admins only; never visible to customers.
grant select, insert (order_id, body) on public.order_internal_notes to authenticated;

create policy order_internal_notes_select on public.order_internal_notes
  for select to authenticated
  using ((select private.has_permission('orders')));
create policy order_internal_notes_insert on public.order_internal_notes
  for insert to authenticated
  with check ((select private.has_permission('orders')) and author_id = (select auth.uid()));

-- Receipts: read own or orders admin. Writes via server ingest (Phase 5).
grant select on public.payment_receipts to authenticated;

create policy payment_receipts_select on public.payment_receipts
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.has_permission('orders')));

-- Invoices: a customer sees issued invoices of their own orders; invoices admins see all.
grant select on public.invoices to authenticated;

create policy invoices_select on public.invoices
  for select to authenticated
  using (
    (status = 'issued' and exists (
      select 1 from public.orders o
       where o.id = order_id and o.user_id = (select auth.uid())))
    or (select private.has_permission('invoices'))
  );

-- Comments: public read of visible; verified, unblocked customers post as
-- themselves; comments admins moderate.
grant select on public.comments to anon, authenticated;
grant insert (product_id, body) on public.comments to authenticated;
grant update (status, hidden_reason) on public.comments to authenticated;
grant delete on public.comments to authenticated;

create policy comments_select on public.comments
  for select to anon, authenticated
  using (
    status = 'visible'
    or user_id = (select auth.uid())
    or (select private.has_permission('comments'))
  );
create policy comments_insert_own on public.comments
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p
       where p.id = (select auth.uid())
         and p.phone_verified_at is not null
         and not p.is_blocked)
    and exists (select 1 from public.products pr where pr.id = product_id)
  );
create policy comments_moderate on public.comments
  for update to authenticated
  using ((select private.has_permission('comments')))
  with check ((select private.has_permission('comments')));
create policy comments_delete on public.comments
  for delete to authenticated
  using (user_id = (select auth.uid()) or (select private.has_permission('comments')));

-- Message log: orders admins read; server writes.
grant select on public.message_logs to authenticated;

create policy message_logs_select on public.message_logs
  for select to authenticated
  using ((select private.has_permission('orders')));

-- private.* tables: RLS on, no grants, no policies. Only service_role/postgres.
