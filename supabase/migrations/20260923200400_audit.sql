-- Audit log: append-only at the database level, not by convention.
--   * No INSERT/UPDATE/DELETE/TRUNCATE grant for anon, authenticated or
--     service_role. Rows are written only by SECURITY DEFINER triggers.
--   * BEFORE UPDATE/DELETE and BEFORE TRUNCATE triggers raise, so even a role
--     that somehow holds the privilege (including service_role) is refused.
--   * Only the owner can read it.
-- Known limit: a Postgres superuser can disable triggers. On Supabase that is
-- the platform's supabase_admin, not any application role.

create table public.audit_logs (
  id bigint generated always as identity primary key,
  -- No FK: audit history must survive deletion of the actor's account.
  actor_id uuid,
  actor_role text,
  action text not null,
  entity_type text not null,
  entity_id text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_entity on public.audit_logs (entity_type, entity_id, created_at desc);
create index audit_logs_actor on public.audit_logs (actor_id, created_at desc);
create index audit_logs_created on public.audit_logs (created_at desc);

alter table public.audit_logs enable row level security;

revoke all on public.audit_logs from public, anon, authenticated, service_role;
grant select on public.audit_logs to authenticated, service_role;

create policy audit_logs_owner_read on public.audit_logs
  for select to authenticated
  using ((select private.is_owner()));

create function private.audit_logs_block_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'AUDIT_LOG_APPEND_ONLY' using errcode = '42501';
end;
$$;

create trigger audit_logs_no_update_delete
  before update or delete on public.audit_logs
  for each row execute function private.audit_logs_block_mutation();

create trigger audit_logs_no_truncate
  before truncate on public.audit_logs
  for each statement execute function private.audit_logs_block_mutation();

-- Generic row auditor. Trigger arguments = columns to leave out of the log
-- (sensitive or noisy). UPDATEs record only the columns that changed and are
-- skipped entirely when nothing meaningful changed.
create function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_excluded text[] := coalesce(tg_argv::text[], '{}') || array['updated_at'];
  v_row jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  v_old jsonb;
  v_new jsonb;
  v_changed text[];
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old := to_jsonb(old) - v_excluded;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new := to_jsonb(new) - v_excluded;
  end if;

  if tg_op = 'UPDATE' then
    select coalesce(array_agg(k), '{}') into v_changed
      from jsonb_object_keys(v_new) as k
     where v_new -> k is distinct from v_old -> k;
    if cardinality(v_changed) = 0 then
      return null;
    end if;
    select jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k)
      into v_old, v_new
      from unnest(v_changed) as k;
  end if;

  insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, old_data, new_data)
  values (
    (select auth.uid()),
    coalesce((select auth.jwt() ->> 'role'), session_user::text),
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'user_id', v_row ->> 'admin_id'),
    v_old,
    v_new
  );
  return null;
end;
$$;

revoke execute on function private.audit_row() from public, anon, authenticated;
revoke execute on function private.audit_logs_block_mutation() from public, anon, authenticated;

-- What is audited (spec §4): order status changes, KYC decisions, price and
-- catalog changes, deletions, permission changes, invoice generation,
-- settings (rate/threshold/bank accounts), receipt reviews, moderation.
create trigger audit_orders
  after update or delete on public.orders
  for each row execute function private.audit_row('fulfillment_data', 'fulfillment_fields');
create trigger audit_order_internal_notes
  after insert or delete on public.order_internal_notes
  for each row execute function private.audit_row();
create trigger audit_payment_receipts
  after update or delete on public.payment_receipts
  for each row execute function private.audit_row();
create trigger audit_kyc_submissions
  after update or delete on public.kyc_submissions
  for each row execute function private.audit_row();
create trigger audit_profiles
  after update or delete on public.profiles
  for each row execute function private.audit_row();
create trigger audit_categories
  after insert or update or delete on public.categories
  for each row execute function private.audit_row();
create trigger audit_products
  after insert or update or delete on public.products
  for each row execute function private.audit_row('search_text', 'completed_orders_count');
create trigger audit_product_variants
  after insert or update or delete on public.product_variants
  for each row execute function private.audit_row();
create trigger audit_app_settings
  after update on public.app_settings
  for each row execute function private.audit_row('usd_sdg_rate_updated_at');
create trigger audit_security_settings
  after update on public.security_settings
  for each row execute function private.audit_row();
create trigger audit_bank_accounts
  after insert or update or delete on public.bank_accounts
  for each row execute function private.audit_row();
create trigger audit_admins
  after insert or update or delete on public.admins
  for each row execute function private.audit_row();
create trigger audit_admin_permissions
  after insert or update or delete on public.admin_permissions
  for each row execute function private.audit_row();
create trigger audit_invoices
  after insert or update on public.invoices
  for each row execute function private.audit_row('snapshot');
create trigger audit_comments
  after update or delete on public.comments
  for each row execute function private.audit_row();
