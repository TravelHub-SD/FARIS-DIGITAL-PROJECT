-- Phase 6: admin dashboard support.
--   * Abuse limits move from code to security_settings (settings admins edit
--     them without a deploy; not publicly readable, unlike app_settings).
--   * set_customer_blocked(): the only way to block a customer; never the
--     caller, never the owner, and only the owner may block another admin.
--   * Comments: per-customer rate limit, moderator recorded by trigger, and a
--     public read function that exposes first names only.
--   * admin_orders(): orders list search for the dashboard (invoker + explicit
--     permission check).
--   * public-assets writes are confined by path: products/ and categories/
--     for catalog staff, site/ for settings staff.
--   * admins: only complete, unblocked accounts can be made admins; the
--     granting admin is recorded by trigger, not taken from the caller.

-- 1. Limits as settings -------------------------------------------------------
alter table public.security_settings
  add column order_rate_limit_per_hour integer not null default 10
    check (order_rate_limit_per_hour between 1 and 1000),
  add column receipts_per_order_limit integer not null default 5
    check (receipts_per_order_limit between 1 and 50),
  add column comment_rate_limit_per_hour integer not null default 5
    check (comment_rate_limit_per_hour between 1 and 100);

grant update (order_rate_limit_per_hour, receipts_per_order_limit, comment_rate_limit_per_hour)
  on public.security_settings to authenticated;

create or replace function public.create_order(
  p_variant_id uuid,
  p_quantity integer,
  p_fulfillment jsonb,
  p_idempotency_key uuid,
  p_expected_total_sdg numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_order public.orders;
  v_live numeric;
  v_msg text;
  v_reason text;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    return jsonb_build_object('status', 'error', 'reason', 'invalid_input');
  end if;

  -- Same submission again (double click, retry after a timeout): same order.
  select * into v_order from public.orders
   where user_id = v_uid and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('status', 'created', 'id', v_order.id, 'reference', v_order.reference);
  end if;

  if p_quantity is null or p_quantity < 1 or p_quantity > 10 then
    return jsonb_build_object('status', 'error', 'reason', 'invalid_quantity');
  end if;

  -- Abuse guard: each order may trigger staff work and notifications.
  -- The limit is a setting (security_settings), editable without a deploy.
  if (select count(*) from public.orders
       where user_id = v_uid and created_at > now() - interval '1 hour')
     >= (select s.order_rate_limit_per_hour from public.security_settings s where s.id) then
    return jsonb_build_object('status', 'error', 'reason', 'rate_limited');
  end if;

  -- The customer must have seen (and agreed to) the price the database
  -- charges now. A forged, stale or swapped-variant total never matches.
  v_live := private.live_total_sdg(p_variant_id, p_quantity);
  if v_live is null then
    return jsonb_build_object('status', 'error', 'reason', 'variant_unavailable');
  end if;
  if p_expected_total_sdg is distinct from v_live then
    return jsonb_build_object('status', 'price_changed', 'total_sdg', v_live);
  end if;

  begin
    insert into public.orders (user_id, variant_id, quantity, fulfillment_data, idempotency_key)
    values (v_uid, p_variant_id, p_quantity::smallint, coalesce(p_fulfillment, '{}'::jsonb), p_idempotency_key)
    returning * into v_order;

    -- The trigger derived the snapshot in its own statement; a rate or price
    -- change between the check above and the insert must not slip through.
    if v_order.total_sdg <> p_expected_total_sdg then
      raise exception 'PRICE_CHANGED' using errcode = 'P0001';
    end if;
  exception
    when unique_violation then
      select * into v_order from public.orders
       where user_id = v_uid and idempotency_key = p_idempotency_key;
      if found then
        return jsonb_build_object('status', 'created', 'id', v_order.id, 'reference', v_order.reference);
      end if;
      raise;
    when raise_exception then
      get stacked diagnostics v_msg = message_text;
      if v_msg = 'PRICE_CHANGED' then
        return jsonb_build_object('status', 'price_changed',
                                  'total_sdg', private.live_total_sdg(p_variant_id, p_quantity));
      end if;
      v_reason := case
        when v_msg = 'KYC_REQUIRED' then 'kyc_required'
        when v_msg = 'PHONE_NOT_VERIFIED' then 'phone_not_verified'
        when v_msg = 'CUSTOMER_BLOCKED' then 'customer_blocked'
        when v_msg = 'CUSTOMER_NOT_FOUND' then 'phone_not_verified'
        when v_msg = 'VARIANT_UNAVAILABLE' then 'variant_unavailable'
        when v_msg = 'PRICING_NOT_CONFIGURED' then 'variant_unavailable'
        when v_msg = 'INVALID_QUANTITY' then 'invalid_quantity'
        when v_msg like 'FULFILLMENT_INVALID%' then 'fulfillment_invalid'
      end;
      if v_reason is null then
        raise;
      end if;
      return jsonb_build_object('status', 'error', 'reason', v_reason);
  end;

  return jsonb_build_object('status', 'created', 'id', v_order.id, 'reference', v_order.reference);
end;
$$;

create or replace function public.submit_receipt(
  p_order_id uuid,
  p_bank_account_id uuid,
  p_transaction_ref text,
  p_storage_path text
)
returns public.payment_receipts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_order public.orders;
  v_ref text := btrim(coalesce(p_transaction_ref, ''));
  v_ref_norm text;
  v_object record;
  v_row public.payment_receipts;
  v_constraint text;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  -- Someone else's order and a missing order look the same.
  select * into v_order from public.orders where id = p_order_id and user_id = v_uid for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_order.status <> 'new' then
    raise exception 'ORDER_NOT_AWAITING_PAYMENT' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.payment_receipts r
              where r.order_id = p_order_id and r.status = 'accepted') then
    raise exception 'PAYMENT_ALREADY_ACCEPTED' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.payment_receipts r
              where r.order_id = p_order_id and r.status = 'pending') then
    raise exception 'RECEIPT_ALREADY_PENDING' using errcode = 'P0001';
  end if;
  if (select count(*) from public.payment_receipts r where r.order_id = p_order_id)
     >= (select s.receipts_per_order_limit from public.security_settings s where s.id) then
    raise exception 'RECEIPT_LIMIT' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.bank_accounts b where b.id = p_bank_account_id and b.is_active) then
    raise exception 'BANK_ACCOUNT_INVALID' using errcode = 'P0001';
  end if;

  v_ref_norm := upper(regexp_replace(v_ref, '[[:space:]-]+', '', 'g'));
  if char_length(v_ref) > 64 or v_ref_norm !~ '^[A-Z0-9]{4,40}$' then
    raise exception 'TRANSACTION_REF_INVALID' using errcode = 'P0001';
  end if;

  if p_storage_path is null or p_storage_path !~ ('^' || v_uid::text || '/' || p_order_id::text
       || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$') then
    raise exception 'RECEIPT_INVALID_PATH' using errcode = '42501';
  end if;
  select o.metadata ->> 'mimetype' as mime, o.user_metadata ->> 'sha256' as sha256
    into v_object
    from storage.objects o
   where o.bucket_id = 'payment-receipts' and o.name = p_storage_path;
  if not found then
    raise exception 'RECEIPT_FILE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_object.mime is distinct from 'image/jpeg' or v_object.sha256 !~ '^[0-9a-f]{64}$'
     or v_object.sha256 is null then
    raise exception 'RECEIPT_FILE_INVALID' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.payment_receipts r where r.storage_path = p_storage_path) then
    raise exception 'RECEIPT_FILE_INVALID' using errcode = 'P0001';
  end if;

  -- Friendly checks first; the unique indexes below are the real guarantee
  -- (they also hold for concurrent submissions and for any other insert path).
  if exists (select 1 from public.payment_receipts r
              where r.bank_account_id = p_bank_account_id
                and r.transaction_ref_norm = v_ref_norm and r.status <> 'rejected') then
    raise exception 'DUPLICATE_TRANSACTION' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.payment_receipts r
              where r.file_sha256 = v_object.sha256 and r.status <> 'rejected') then
    raise exception 'DUPLICATE_RECEIPT_FILE' using errcode = 'P0001';
  end if;

  begin
    insert into public.payment_receipts (order_id, bank_account_id, transaction_ref, storage_path, file_sha256)
    values (p_order_id, p_bank_account_id, v_ref, p_storage_path, v_object.sha256)
    returning * into v_row;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    raise exception '%', case v_constraint
      when 'payment_receipts_txn_unique' then 'DUPLICATE_TRANSACTION'
      when 'payment_receipts_sha256_unique' then 'DUPLICATE_RECEIPT_FILE'
      else 'RECEIPT_ALREADY_PENDING' end
      using errcode = 'P0001';
  end;
  return v_row;
end;
$$;

-- 2. Blocking customers -------------------------------------------------------
create function public.set_customer_blocked(p_user_id uuid, p_blocked boolean)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.profiles;
begin
  if not private.has_permission('customers') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_blocked is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;
  if p_user_id = (select auth.uid()) then
    raise exception 'CANNOT_BLOCK_SELF' using errcode = '42501';
  end if;
  if exists (select 1 from public.admins a where a.user_id = p_user_id and a.is_owner) then
    raise exception 'OWNER_PROTECTED' using errcode = '42501';
  end if;
  if exists (select 1 from public.admins a where a.user_id = p_user_id and a.is_active)
     and not private.is_owner() then
    raise exception 'ADMIN_PROTECTED' using errcode = '42501';
  end if;
  update public.profiles set is_blocked = p_blocked where id = p_user_id
  returning * into v_row;
  if not found then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

-- 3. Comments -----------------------------------------------------------------
create function private.comments_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A customer always posts as themselves (no JWT = server/seed insert).
  new.user_id := coalesce((select auth.uid()), new.user_id);
  if (select count(*) from public.comments c
       where c.user_id = new.user_id and c.created_at > now() - interval '1 hour')
     >= (select s.comment_rate_limit_per_hour from public.security_settings s where s.id) then
    raise exception 'COMMENT_RATE_LIMIT' using errcode = 'P0001';
  end if;
  new.body := btrim(new.body);
  new.status := 'visible';
  new.hidden_by := null;
  new.hidden_reason := null;
  new.created_at := now();
  return new;
end;
$$;

create trigger comments_before_insert
  before insert on public.comments
  for each row execute function private.comments_before_insert();

-- The moderator is whoever changed the status, never a value from the client.
create function private.comments_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.hidden_by := case when new.status = 'hidden' then (select auth.uid()) end;
  else
    new.hidden_by := old.hidden_by;
  end if;
  if new.status = 'visible' then
    new.hidden_reason := null;
  end if;
  return new;
end;
$$;

create trigger comments_before_update
  before update on public.comments
  for each row execute function private.comments_before_update();

-- Public comment list for a product page. Definer so it can show the
-- author's first name without opening profiles to anonymous reads; returns
-- only visible comments of a visible product, and nothing else about anyone.
create function public.product_comments(p_product_id uuid)
returns table (id uuid, body text, created_at timestamptz, author text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.body, c.created_at,
         nullif(split_part(btrim(coalesce(p.full_name, '')), ' ', 1), '') as author
    from public.comments c
    join public.products pr on pr.id = c.product_id
    join public.categories cat on cat.id = pr.category_id
    left join public.profiles p on p.id = c.user_id
   where c.product_id = p_product_id
     and c.status = 'visible'
     and pr.is_active and pr.archived_at is null
     and cat.is_active and cat.archived_at is null
   order by c.created_at desc
   limit 50;
$$;

-- 4. Orders search for the dashboard ------------------------------------------
create function public.admin_orders(
  p_status text default null,
  p_from date default null,
  p_to date default null,
  p_q text default null,
  p_min_sdg numeric default null,
  p_max_sdg numeric default null,
  p_payment_review boolean default false,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  reference text,
  status text,
  created_at timestamptz,
  total_sdg numeric,
  quantity smallint,
  product_name_ar text,
  product_name_en text,
  variant_name_ar text,
  variant_name_en text,
  customer_name text,
  customer_phone text,
  pending_receipt boolean,
  total_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_q text := nullif(btrim(left(coalesce(p_q, ''), 100)), '');
  v_like text;
  v_digits text;
  v_txn text;
begin
  if not private.has_permission('orders') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_q is not null then
    v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    -- Local numbers are typed as 09…; stored as +2499…
    v_digits := nullif(ltrim(regexp_replace(v_q, '[^0-9]', '', 'g'), '0'), '');
    if char_length(coalesce(v_digits, '')) < 4 then
      v_digits := null;
    end if;
    v_txn := upper(regexp_replace(v_q, '[[:space:]-]+', '', 'g'));
  end if;

  return query
  select o.id, o.reference, o.status, o.created_at, o.total_sdg, o.quantity,
         o.product_name_ar, o.product_name_en, o.variant_name_ar, o.variant_name_en,
         p.full_name, p.phone_e164,
         exists (select 1 from public.payment_receipts r
                  where r.order_id = o.id and r.status = 'pending'),
         count(*) over ()
    from public.orders o
    join public.profiles p on p.id = o.user_id
   where (p_status is null or o.status = p_status)
     and (p_from is null or o.created_at >= (p_from::timestamp at time zone 'Africa/Khartoum'))
     and (p_to is null or o.created_at < ((p_to + 1)::timestamp at time zone 'Africa/Khartoum'))
     and (p_min_sdg is null or o.total_sdg >= p_min_sdg)
     and (p_max_sdg is null or o.total_sdg <= p_max_sdg)
     and (not coalesce(p_payment_review, false) or exists (
           select 1 from public.payment_receipts r
            where r.order_id = o.id and r.status = 'pending'))
     and (v_q is null
          or o.reference ilike v_like
          or p.full_name ilike v_like
          or (v_digits is not null and p.phone_e164 like '%' || v_digits || '%')
          or exists (select 1 from public.payment_receipts r
                      where r.order_id = o.id and r.transaction_ref_norm = v_txn))
   order by o.created_at desc
   limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- 5. public-assets: writes confined by path ---------------------------------
drop policy "public-assets: staff insert" on storage.objects;
drop policy "public-assets: staff update" on storage.objects;
drop policy "public-assets: staff delete" on storage.objects;
drop policy "public-assets: staff list" on storage.objects;

create function private.can_write_public_asset(p_name text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when p_name like 'products/%' or p_name like 'categories/%' then private.has_permission('products')
    when p_name like 'site/%' then private.has_permission('settings')
    else false
  end;
$$;

create policy "public-assets: staff insert by path"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'public-assets' and (select private.can_write_public_asset(name)));
create policy "public-assets: staff update by path"
  on storage.objects for update to authenticated
  using (bucket_id = 'public-assets' and (select private.can_write_public_asset(name)))
  with check (bucket_id = 'public-assets' and (select private.can_write_public_asset(name)));
create policy "public-assets: staff delete by path"
  on storage.objects for delete to authenticated
  using (bucket_id = 'public-assets' and (select private.can_write_public_asset(name)));
create policy "public-assets: staff list by path"
  on storage.objects for select to authenticated
  using (bucket_id = 'public-assets' and (select private.can_write_public_asset(name)));

-- 6. Admin rows: target must be a complete, unblocked account ---------------
create function private.admins_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p
                  where p.id = new.user_id and p.phone_verified_at is not null
                    and not p.is_blocked) then
    raise exception 'ADMIN_TARGET_INVALID' using errcode = 'P0001';
  end if;
  new.created_by := (select auth.uid());
  return new;
end;
$$;

create trigger admins_before_insert
  before insert on public.admins
  for each row execute function private.admins_before_insert();

create function private.admin_permissions_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.granted_by := (select auth.uid());
  new.granted_at := now();
  return new;
end;
$$;

create trigger admin_permissions_before_insert
  before insert on public.admin_permissions
  for each row execute function private.admin_permissions_before_insert();

-- 7. FAQ edits are audited like other content -------------------------------
create trigger audit_faqs
  after insert or update or delete on public.faqs
  for each row execute function private.audit_row();

-- Grants ----------------------------------------------------------------------
revoke execute on function private.comments_before_insert() from public, anon, authenticated;
revoke execute on function private.comments_before_update() from public, anon, authenticated;
revoke execute on function private.admins_before_insert() from public, anon, authenticated;
revoke execute on function private.admin_permissions_before_insert() from public, anon, authenticated;
-- Evaluated inside storage RLS with the caller's privileges.
grant execute on function private.can_write_public_asset(text) to authenticated;

revoke execute on function public.set_customer_blocked(uuid, boolean) from public, anon;
revoke execute on function public.product_comments(uuid) from public;
revoke execute on function public.admin_orders(text, date, date, text, numeric, numeric, boolean, integer, integer) from public, anon;
grant execute on function public.set_customer_blocked(uuid, boolean) to authenticated;
grant execute on function public.product_comments(uuid) to anon, authenticated;
grant execute on function public.admin_orders(text, date, date, text, numeric, numeric, boolean, integer, integer) to authenticated;

-- Social accounts from docs/spec.md §10 (production facts, now editable in
-- the dashboard; the footer reads them from here).
update public.app_settings
   set social_links = jsonb_build_object(
         'facebook', 'https://www.facebook.com/farishassanz',
         'instagram', 'https://www.instagram.com/farishassanz',
         'x', 'https://x.com/farishassanz',
         'telegram', 'https://t.me/farishassanz')
 where id and social_links = '{}'::jsonb;

-- Moderation list: comments staff see the author's name (not their phone or
-- anything else from profiles, which they cannot read).
create function public.admin_comments(
  p_status public.comment_status default null,
  p_q text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  body text,
  status public.comment_status,
  hidden_reason text,
  created_at timestamptz,
  product_slug text,
  product_name_ar text,
  product_name_en text,
  author text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_like text := '%' || replace(replace(replace(
    btrim(left(coalesce(p_q, ''), 100)), '\', '\\'), '%', '\%'), '_', '\_') || '%';
begin
  if not private.has_permission('comments') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return query
  select c.id, c.body, c.status, c.hidden_reason, c.created_at,
         pr.slug, pr.name_ar, pr.name_en, p.full_name, count(*) over ()
    from public.comments c
    join public.products pr on pr.id = c.product_id
    left join public.profiles p on p.id = c.user_id
   where (p_status is null or c.status = p_status)
     and (coalesce(btrim(p_q), '') = '' or c.body ilike v_like
          or pr.name_ar ilike v_like or pr.name_en ilike v_like)
   order by c.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke execute on function public.admin_comments(public.comment_status, text, integer, integer) from public, anon;
grant execute on function public.admin_comments(public.comment_status, text, integer, integer) to authenticated;

-- GraphQL is not used by the app. Hosted projects enable pg_graphql by
-- default; dropping it removes a second query surface over the same tables
-- (RLS would still apply — the Phase 6 tests re-enable it to prove that).
drop extension if exists pg_graphql;
