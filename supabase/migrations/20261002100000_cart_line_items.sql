-- Shopping cart and orders with line items (decisions.md 2026-09-30).
--
-- * An order is a header (customer, reference, status, rate, totals) plus one
--   or more lines in `order_items`. Each line keeps the snapshot a single-item
--   order used to keep: names, quantity, unit price, fulfillment fields/data.
-- * Money is still derived only by the database. A line's price comes from
--   the variant at insert time; the line's SDG amount is rounded up per line
--   (ceil(line_usd × rate)); the order total is the sum of its lines (approved
--   by Hassan: invoice lines always add up to the total; a single-line order
--   is charged exactly what the old formula charged).
-- * KYC applies to the order total plus the customer's other non-cancelled
--   orders of the last `security_settings.kyc_window_hours` hours (default 24,
--   0 = this order only), so splitting a purchase does not avoid it.
-- * Every existing order becomes one line with its stored snapshot copied as
--   is (never re-derived from today's prices). Totals, references and invoice
--   numbers do not change; issued invoices are not touched.
-- * The cart lives in `cart_items`, per signed-in customer, under RLS. It
--   holds a variant, a quantity and the fulfillment data, never a price.
--   checkout_cart() turns it into one order in one transaction.

-- 1. Setting: the rolling KYC window --------------------------------------------
-- In security_settings (settings staff only, not public; audited by
-- audit_security_settings): the exact window is not advertised to splitters.
alter table public.security_settings
  add column kyc_window_hours integer not null default 24
    check (kyc_window_hours between 0 and 720);
grant update (kyc_window_hours) on public.security_settings to authenticated;

-- 2. Order lines, backfilled from the existing single-item orders -------------
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  line_no smallint not null check (line_no between 1 and 20),
  variant_id uuid not null references public.product_variants (id) on delete restrict,
  -- Immutable snapshot (derived by trigger).
  product_name_ar text,
  product_name_en text,
  variant_name_ar text,
  variant_name_en text,
  quantity smallint not null check (quantity between 1 and 10),
  unit_price_usd numeric(12, 2) not null check (unit_price_usd > 0),
  line_total_usd numeric(12, 2) not null,
  usd_sdg_rate numeric(14, 4) not null check (usd_sdg_rate > 0),
  line_total_sdg numeric(16, 2) not null,
  fulfillment_fields jsonb not null default '[]' check (jsonb_typeof(fulfillment_fields) = 'array'),
  fulfillment_data jsonb not null default '{}' check (jsonb_typeof(fulfillment_data) = 'object'),
  created_at timestamptz not null default now(),
  unique (order_id, line_no),
  constraint order_items_total_usd_formula check (line_total_usd = unit_price_usd * quantity),
  -- Rounded up per line to whole pounds (the old per-order rule, per line).
  constraint order_items_total_sdg_formula check (line_total_sdg = ceil(line_total_usd * usd_sdg_rate))
);

create index order_items_variant on public.order_items (variant_id);

-- Copy, not recompute: the old CHECKs guarantee total_sdg = ceil(total_usd ×
-- rate) and total_usd = unit × quantity, so each copied line satisfies the
-- line CHECKs and sums to exactly the order's stored totals.
insert into public.order_items
  (order_id, line_no, variant_id, product_name_ar, product_name_en, variant_name_ar,
   variant_name_en, quantity, unit_price_usd, line_total_usd, usd_sdg_rate, line_total_sdg,
   fulfillment_fields, fulfillment_data, created_at)
select o.id, 1, o.variant_id, o.product_name_ar, o.product_name_en, o.variant_name_ar,
       o.variant_name_en, o.quantity, o.unit_price_usd, o.total_usd, o.usd_sdg_rate, o.total_sdg,
       o.fulfillment_fields, o.fulfillment_data, o.created_at
  from public.orders o;

-- The header no longer carries line data. The per-order SDG formula is
-- replaced by the per-line formula above plus the sum check below.
alter table public.orders
  drop constraint orders_total_usd_formula,
  drop constraint orders_total_sdg_formula,
  drop column variant_id,
  drop column product_name_ar,
  drop column product_name_en,
  drop column variant_name_ar,
  drop column variant_name_en,
  drop column quantity,
  drop column unit_price_usd,
  drop column fulfillment_fields,
  drop column fulfillment_data,
  add constraint orders_totals_non_negative check (total_usd >= 0 and total_sdg >= 0);

-- 3. KYC over the order total and the rolling window ---------------------------
-- USD, like the threshold (decisions.md 2026-09-23). Cancelled orders do not
-- count; unpaid new ones do (a splitter creates exactly those).
create function private.kyc_window_total_usd(p_user_id uuid, p_exclude_order uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(o.total_usd), 0)
    from public.orders o, public.security_settings s
   where s.id
     and s.kyc_window_hours > 0
     and o.user_id = p_user_id
     and o.id is distinct from p_exclude_order
     and o.status <> 'cancelled'
     and o.created_at > now() - make_interval(hours => s.kyc_window_hours);
$$;

create function private.kyc_required_for(p_user_id uuid, p_order_id uuid, p_total_usd numeric)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_total_usd + private.kyc_window_total_usd(p_user_id, p_order_id) >= s.kyc_threshold_usd
    from public.app_settings s where s.id;
$$;

-- 4. Order header -------------------------------------------------------------
-- Customer checks, rate snapshot, reference, status. Totals start at zero and
-- are recomputed from the lines as they are inserted.
create or replace function private.orders_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings record;
  v_customer record;
  v_bytes bytea;
  v_attempt integer := 0;
begin
  -- One order at a time per customer: the KYC window sum must see the
  -- customer's previous order, even when two checkouts race.
  perform pg_advisory_xact_lock(hashtextextended('orders:' || new.user_id::text, 0));

  select s.usd_sdg_rate, s.kyc_threshold_usd into v_settings
    from public.app_settings s where s.id;
  if v_settings.usd_sdg_rate is null or v_settings.kyc_threshold_usd is null then
    raise exception 'PRICING_NOT_CONFIGURED' using errcode = 'P0001';
  end if;

  select p.is_blocked, p.phone_verified_at into v_customer
    from public.profiles p where p.id = new.user_id;
  if not found then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_customer.is_blocked then
    raise exception 'CUSTOMER_BLOCKED' using errcode = 'P0001';
  end if;
  if v_customer.phone_verified_at is null then
    raise exception 'PHONE_NOT_VERIFIED' using errcode = 'P0001';
  end if;

  -- Whatever the caller sent for these is discarded.
  new.usd_sdg_rate := v_settings.usd_sdg_rate;
  new.total_usd := 0;
  new.total_sdg := 0;
  new.kyc_required := false;
  new.status := 'new';
  new.created_at := now();
  new.updated_at := now();
  new.completed_at := null;
  new.cancelled_at := null;

  -- Non-sequential, human-readable reference: FD- + 7 random digits.
  loop
    v_bytes := extensions.gen_random_bytes(4);
    new.reference := 'FD-' || lpad(
      ((get_byte(v_bytes, 0)::bigint << 24 | get_byte(v_bytes, 1) << 16
        | get_byte(v_bytes, 2) << 8 | get_byte(v_bytes, 3)) % 10000000)::text, 7, '0');
    exit when not exists (select 1 from public.orders o where o.reference = new.reference);
    v_attempt := v_attempt + 1;
    if v_attempt >= 10 then
      raise exception 'REFERENCE_GENERATION_FAILED' using errcode = 'P0001';
    end if;
  end loop;

  return new;
end;
$$;

-- Snapshot immutable; status machine; totals change only when a line is
-- added in the order's own creating transaction (flag set by the line
-- trigger), and then only to the sums of the lines, never to a given value.
create or replace function private.orders_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mutable text[] := array['status', 'updated_at', 'completed_at', 'cancelled_at'];
begin
  if current_setting('app.order_items_sync', true) = old.id::text then
    if new.status is distinct from old.status then
      raise exception 'ORDER_SNAPSHOT_IMMUTABLE' using errcode = '42501';
    end if;
    select coalesce(sum(i.line_total_usd), 0), coalesce(sum(i.line_total_sdg), 0)
      into new.total_usd, new.total_sdg
      from public.order_items i where i.order_id = old.id;
    new.kyc_required := private.kyc_required_for(old.user_id, old.id, new.total_usd);
    v_mutable := v_mutable || array['total_usd', 'total_sdg', 'kyc_required'];
  end if;

  if (to_jsonb(new) - v_mutable) is distinct from (to_jsonb(old) - v_mutable) then
    raise exception 'ORDER_SNAPSHOT_IMMUTABLE' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if not exists (select 1 from public.order_status_transitions t
                    where t.from_status = old.status and t.to_status = new.status) then
      raise exception 'INVALID_STATUS_TRANSITION: % -> %', old.status, new.status
        using errcode = 'P0001';
    end if;
    if new.status = 'processing' and not exists (
         select 1 from public.payment_receipts r
          where r.order_id = new.id and r.status = 'accepted') then
      raise exception 'PAYMENT_NOT_ACCEPTED' using errcode = 'P0001';
    end if;
    new.completed_at := case when new.status = 'completed' then now() else old.completed_at end;
    new.cancelled_at := case when new.status = 'cancelled' then now() else old.cancelled_at end;
  else
    new.completed_at := old.completed_at;
    new.cancelled_at := old.cancelled_at;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- A finished order: at least one line, totals equal the sums of the lines,
-- and the KYC rule holds for its total (plus the window). Called by the
-- order-creating functions right away (friendly errors) and, for any other
-- insert path, by a deferred constraint trigger at commit.
create function private.assert_order_complete(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_lines record;
begin
  select o.user_id, o.total_usd, o.total_sdg, p.kyc_status into v_order
    from public.orders o join public.profiles p on p.id = o.user_id
   where o.id = p_order_id;
  if not found then
    return;
  end if;
  select count(*) as n, coalesce(sum(i.line_total_usd), 0) as usd,
         coalesce(sum(i.line_total_sdg), 0) as sdg
    into v_lines
    from public.order_items i where i.order_id = p_order_id;
  if v_lines.n = 0 then
    raise exception 'ORDER_HAS_NO_ITEMS' using errcode = 'P0001';
  end if;
  if v_order.total_usd <> v_lines.usd or v_order.total_sdg <> v_lines.sdg then
    raise exception 'ORDER_TOTALS_MISMATCH' using errcode = 'P0001';
  end if;
  if private.kyc_required_for(v_order.user_id, p_order_id, v_order.total_usd)
     and v_order.kyc_status <> 'verified' then
    raise exception 'KYC_REQUIRED' using errcode = 'P0001';
  end if;
end;
$$;

create function private.orders_complete_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_order_complete(new.id);
  return null;
end;
$$;

create constraint trigger orders_complete_check
  after insert on public.orders
  deferrable initially deferred
  for each row execute function private.orders_complete_check();

-- Audit: the header is written before its lines, so its creation is logged
-- once at commit, with the final totals; the internal total updates made
-- while lines are added are not logged. Status changes are logged as before.
drop trigger audit_orders on public.orders;
create trigger audit_orders
  after update or delete on public.orders
  for each row
  when (coalesce(current_setting('app.order_items_sync', true), '') <> old.id::text)
  execute function private.audit_row();

create function private.audit_order_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.orders;
begin
  select * into v_row from public.orders where id = new.id;
  if not found then
    return null;
  end if;
  insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, new_data)
  values ((select auth.uid()), coalesce((select auth.jwt() ->> 'role'), session_user::text),
          'orders.insert', 'orders', v_row.id::text, to_jsonb(v_row) - 'updated_at');
  return null;
end;
$$;

create constraint trigger audit_orders_insert
  after insert on public.orders
  deferrable initially deferred
  for each row execute function private.audit_order_created();

-- 5. Order lines: derived, immutable, only while the order is being created ---
create function private.order_items_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_variant record;
  v_errors text[];
begin
  select o.status, o.created_at, o.usd_sdg_rate into v_order
    from public.orders o where o.id = new.order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- Lines are added only in the transaction that creates the order.
  if v_order.status <> 'new' or v_order.created_at <> now() then
    raise exception 'ORDER_ITEMS_LOCKED' using errcode = '42501';
  end if;

  select coalesce(max(i.line_no), 0) + 1 into new.line_no
    from public.order_items i where i.order_id = new.order_id;
  if new.line_no > 20 then
    raise exception 'TOO_MANY_ITEMS' using errcode = 'P0001';
  end if;

  select pv.price_usd, pv.max_quantity, pv.required_fields,
         pv.name_ar as variant_ar, pv.name_en as variant_en,
         pr.name_ar as product_ar, pr.name_en as product_en
    into v_variant
    from public.product_variants pv
    join public.products pr on pr.id = pv.product_id
    join public.categories c on c.id = pr.category_id
   where pv.id = new.variant_id
     and pv.is_active and pv.archived_at is null
     and pr.is_active and pr.archived_at is null
     and c.is_active and c.archived_at is null
     for share of pv;
  if not found then
    raise exception 'VARIANT_UNAVAILABLE: line %', new.line_no using errcode = 'P0001';
  end if;

  if new.quantity is null or new.quantity < 1 or new.quantity > v_variant.max_quantity then
    raise exception 'INVALID_QUANTITY: line %', new.line_no using errcode = 'P0001';
  end if;

  v_errors := private.fulfillment_errors(v_variant.required_fields, coalesce(new.fulfillment_data, '{}'::jsonb));
  if cardinality(v_errors) > 0 then
    raise exception 'FULFILLMENT_INVALID: line %: %', new.line_no, array_to_string(v_errors, ',')
      using errcode = 'P0001';
  end if;

  -- Derive the snapshot. Whatever the caller sent for these is discarded.
  new.product_name_ar := v_variant.product_ar;
  new.product_name_en := v_variant.product_en;
  new.variant_name_ar := v_variant.variant_ar;
  new.variant_name_en := v_variant.variant_en;
  new.unit_price_usd := v_variant.price_usd;
  new.line_total_usd := v_variant.price_usd * new.quantity;
  new.usd_sdg_rate := v_order.usd_sdg_rate;
  new.line_total_sdg := ceil(new.line_total_usd * v_order.usd_sdg_rate);
  new.fulfillment_fields := v_variant.required_fields;
  new.created_at := now();
  return new;
end;
$$;

create trigger order_items_before_insert
  before insert on public.order_items
  for each row execute function private.order_items_before_insert();

-- The order's totals follow its lines.
create function private.order_items_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.order_items_sync', new.order_id::text, true);
  update public.orders set updated_at = now() where id = new.order_id;
  perform set_config('app.order_items_sync', '', true);
  return null;
end;
$$;

create trigger order_items_after_insert
  after insert on public.order_items
  for each row execute function private.order_items_after_insert();

-- Lines are immutable, except that sensitive fulfillment values are removed
-- once the order is final (the purge below; only removals).
create function private.order_items_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'fulfillment_data') is distinct from (to_jsonb(old) - 'fulfillment_data') then
    raise exception 'ORDER_SNAPSHOT_IMMUTABLE' using errcode = '42501';
  end if;
  if new.fulfillment_data is distinct from old.fulfillment_data then
    if not exists (select 1 from public.orders o join public.order_statuses s on s.code = o.status
                    where o.id = new.order_id and s.is_terminal)
       or not (old.fulfillment_data @> new.fulfillment_data) then
      raise exception 'FULFILLMENT_DATA_LOCKED' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger order_items_before_update
  before update on public.order_items
  for each row execute function private.order_items_before_update();

create trigger order_items_no_delete
  before delete on public.order_items
  for each row execute function private.forbid_delete();

-- Audited like orders; fulfillment data stays out of the log.
create trigger audit_order_items
  after insert or update or delete on public.order_items
  for each row execute function private.audit_row('fulfillment_data', 'fulfillment_fields');

-- Sensitive fulfillment fields (definitions with "sensitive": true) are
-- removed from every line once the order reaches a terminal status.
create function private.orders_purge_sensitive()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.order_statuses s where s.code = new.status and s.is_terminal) then
    update public.order_items i
       set fulfillment_data = i.fulfillment_data - array(
             select f ->> 'key' from jsonb_array_elements(i.fulfillment_fields) f
              where (f ->> 'sensitive')::boolean is true)
     where i.order_id = new.id
       and exists (select 1 from jsonb_array_elements(i.fulfillment_fields) f
                    where (f ->> 'sensitive')::boolean is true);
  end if;
  return null;
end;
$$;

create trigger orders_purge_sensitive
  after update of status on public.orders
  for each row when (old.status is distinct from new.status)
  execute function private.orders_purge_sensitive();

-- Status history as before; a completed order counts once for each product
-- it contains ("most ordered").
create or replace function private.orders_record_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.order_status_history (order_id, from_status, to_status, changed_by, customer_note)
  values (
    new.id,
    case when tg_op = 'UPDATE' then old.status end,
    new.status,
    (select auth.uid()),
    nullif(current_setting('app.status_note', true), '')
  );

  if tg_op = 'UPDATE' and new.status = 'completed' then
    update public.products p
       set completed_orders_count = p.completed_orders_count + 1
     where p.id in (select pv.product_id
                      from public.order_items i
                      join public.product_variants pv on pv.id = i.variant_id
                     where i.order_id = new.id);
  end if;
  return null;
end;
$$;

-- 6. Creating orders --------------------------------------------------------------
-- Header + lines in one go. p_items: [{variant_id, quantity, fulfillment_data}],
-- 1 to 20 lines; any other key (a price, a name) is ignored.
create function private.insert_order(
  p_user_id uuid,
  p_items jsonb,
  p_idempotency_key uuid,
  p_order_id uuid default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_item jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ORDER_HAS_NO_ITEMS' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 20 then
    raise exception 'TOO_MANY_ITEMS' using errcode = 'P0001';
  end if;

  insert into public.orders (id, user_id, idempotency_key)
  values (coalesce(p_order_id, gen_random_uuid()), p_user_id, p_idempotency_key)
  returning * into v_order;

  for v_item in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(v_item ->> 'variant_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'VARIANT_UNAVAILABLE' using errcode = 'P0001';
    end if;
    if coalesce(v_item ->> 'quantity', '') !~ '^[0-9]{1,2}$' then
      raise exception 'INVALID_QUANTITY' using errcode = 'P0001';
    end if;
    insert into public.order_items (order_id, variant_id, quantity, fulfillment_data)
    values (v_order.id, (v_item ->> 'variant_id')::uuid, (v_item ->> 'quantity')::smallint,
            coalesce(v_item -> 'fulfillment_data', '{}'::jsonb));
  end loop;

  perform private.assert_order_complete(v_order.id);
  select * into v_order from public.orders where id = v_order.id;
  return v_order;
end;
$$;

-- Maps a database error of the order path to the reason the site shows.
create function private.order_error_reason(p_message text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_message = 'KYC_REQUIRED' then 'kyc_required'
    when p_message = 'PHONE_NOT_VERIFIED' then 'phone_not_verified'
    when p_message = 'CUSTOMER_BLOCKED' then 'customer_blocked'
    when p_message = 'CUSTOMER_NOT_FOUND' then 'phone_not_verified'
    when p_message like 'VARIANT_UNAVAILABLE%' then 'variant_unavailable'
    when p_message = 'PRICING_NOT_CONFIGURED' then 'variant_unavailable'
    when p_message like 'INVALID_QUANTITY%' then 'invalid_quantity'
    when p_message like 'FULFILLMENT_INVALID%' then 'fulfillment_invalid'
    when p_message in ('TOO_MANY_ITEMS', 'ORDER_HAS_NO_ITEMS') then 'invalid_input'
  end;
$$;

-- Line number named in an order-path error ("…: line 2…"), or null.
create function private.order_error_line(p_message text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select (regexp_match(p_message, ': line ([0-9]+)'))[1]::integer;
$$;

-- Single-item order (the current product page). Same contract as before:
-- the page sends the total it showed; a different live total creates nothing.
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

  select * into v_order from public.orders
   where user_id = v_uid and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('status', 'created', 'id', v_order.id, 'reference', v_order.reference);
  end if;

  if p_quantity is null or p_quantity < 1 or p_quantity > 10 then
    return jsonb_build_object('status', 'error', 'reason', 'invalid_quantity');
  end if;

  if (select count(*) from public.orders
       where user_id = v_uid and created_at > now() - interval '1 hour')
     >= (select s.order_rate_limit_per_hour from public.security_settings s where s.id) then
    return jsonb_build_object('status', 'error', 'reason', 'rate_limited');
  end if;

  v_live := private.live_total_sdg(p_variant_id, p_quantity);
  if v_live is null then
    return jsonb_build_object('status', 'error', 'reason', 'variant_unavailable');
  end if;
  if p_expected_total_sdg is distinct from v_live then
    return jsonb_build_object('status', 'price_changed', 'total_sdg', v_live);
  end if;

  begin
    v_order := private.insert_order(
      v_uid,
      jsonb_build_array(jsonb_build_object(
        'variant_id', p_variant_id, 'quantity', p_quantity,
        'fulfillment_data', coalesce(p_fulfillment, '{}'::jsonb))),
      p_idempotency_key);
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
      v_reason := private.order_error_reason(v_msg);
      if v_reason is null then
        raise;
      end if;
      return jsonb_build_object('status', 'error', 'reason', v_reason);
  end;

  return jsonb_build_object('status', 'created', 'id', v_order.id, 'reference', v_order.reference);
end;
$$;

-- Trusted server path (service role only): tests and seed scripts create
-- orders for a given customer. Same triggers and checks as every path.
create function public.service_create_order(p_user_id uuid, p_items jsonb, p_idempotency_key uuid)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.insert_order(p_user_id, p_items, p_idempotency_key);
end;
$$;

-- 7. Cart -----------------------------------------------------------------------
create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  variant_id uuid not null references public.product_variants (id) on delete cascade,
  quantity smallint not null default 1 check (quantity between 1 and 10),
  fulfillment_data jsonb not null default '{}'
    check (jsonb_typeof(fulfillment_data) = 'object' and pg_column_size(fulfillment_data) <= 4096),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index cart_items_user on public.cart_items (user_id, created_at);

-- A line is checked when written: orderable variant, quantity within the
-- variant's limit, fulfillment data valid for the variant, at most 20 lines.
-- Checked again at checkout (the variant may be hidden since).
create function private.cart_items_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_variant record;
  v_errors text[];
begin
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
    new.variant_id := old.variant_id;
    new.created_at := old.created_at;
  else
    new.created_at := now();
    perform pg_advisory_xact_lock(hashtextextended('cart:' || new.user_id::text, 0));
    if (select count(*) from public.cart_items c where c.user_id = new.user_id) >= 20 then
      raise exception 'CART_FULL' using errcode = 'P0001';
    end if;
  end if;
  new.updated_at := now();

  if exists (select 1 from public.profiles p where p.id = new.user_id and p.is_blocked) then
    raise exception 'CUSTOMER_BLOCKED' using errcode = 'P0001';
  end if;

  select pv.max_quantity, pv.required_fields into v_variant
    from public.product_variants pv
    join public.products pr on pr.id = pv.product_id
    join public.categories c on c.id = pr.category_id
   where pv.id = new.variant_id
     and pv.is_active and pv.archived_at is null
     and pr.is_active and pr.archived_at is null
     and c.is_active and c.archived_at is null;
  if not found then
    raise exception 'VARIANT_UNAVAILABLE' using errcode = 'P0001';
  end if;
  if new.quantity > v_variant.max_quantity then
    raise exception 'INVALID_QUANTITY' using errcode = 'P0001';
  end if;
  v_errors := private.fulfillment_errors(v_variant.required_fields, new.fulfillment_data);
  if cardinality(v_errors) > 0 then
    raise exception 'FULFILLMENT_INVALID: %', array_to_string(v_errors, ',') using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger cart_items_before_write
  before insert or update on public.cart_items
  for each row execute function private.cart_items_before_write();

alter table public.cart_items enable row level security;

-- The customer's own lines only; staff have no access to carts.
grant select, delete on public.cart_items to authenticated;
grant insert (variant_id, quantity, fulfillment_data) on public.cart_items to authenticated;
grant update (quantity, fulfillment_data) on public.cart_items to authenticated;

create policy cart_items_select on public.cart_items
  for select to authenticated using (user_id = (select auth.uid()));
create policy cart_items_insert on public.cart_items
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy cart_items_update on public.cart_items
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy cart_items_delete on public.cart_items
  for delete to authenticated using (user_id = (select auth.uid()));

-- The caller's cart as the site shows it: names, line totals at the live
-- rate (the amounts checkout will charge), availability, and whether the
-- total needs identity verification (window included). Definer: a line
-- whose variant was hidden since still shows its name, as unavailable.
create function public.my_cart()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with lines as (
    select ci.id, ci.variant_id, ci.quantity, ci.fulfillment_data, ci.created_at,
           pv.required_fields, pv.max_quantity, pv.price_usd,
           pv.name_ar as variant_name_ar, pv.name_en as variant_name_en,
           pr.id as product_id, pr.slug as product_slug, pr.image_path,
           pr.name_ar as product_name_ar, pr.name_en as product_name_en,
           (pv.is_active and pv.archived_at is null
             and pr.is_active and pr.archived_at is null
             and c.is_active and c.archived_at is null) as available
      from public.cart_items ci
      join public.product_variants pv on pv.id = ci.variant_id
      join public.products pr on pr.id = pv.product_id
      join public.categories c on c.id = pr.category_id
     where ci.user_id = (select auth.uid())
  ),
  priced as (
    select l.*, case when l.available and s.usd_sdg_rate is not null
                     then ceil(l.price_usd * l.quantity * s.usd_sdg_rate) end as line_total_sdg,
           case when l.available then l.price_usd * l.quantity end as line_total_usd
      from lines l, public.app_settings s where s.id
  )
  select jsonb_build_object(
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'variant_id', p.variant_id, 'product_id', p.product_id,
        'product_slug', p.product_slug, 'image_path', p.image_path,
        'product_name_ar', p.product_name_ar, 'product_name_en', p.product_name_en,
        'variant_name_ar', p.variant_name_ar, 'variant_name_en', p.variant_name_en,
        'quantity', p.quantity, 'max_quantity', p.max_quantity,
        'fulfillment_data', p.fulfillment_data, 'required_fields', p.required_fields,
        'available', p.available and p.line_total_sdg is not null,
        'line_total_sdg', p.line_total_sdg) order by p.created_at, p.id)
      from priced p), '[]'::jsonb),
    'total_sdg', (select coalesce(sum(p.line_total_sdg), 0) from priced p),
    'unavailable', (select count(*) from priced p where p.line_total_sdg is null),
    'kyc_needed', coalesce((
      select private.kyc_required_for(u.id, null, (select coalesce(sum(p.line_total_usd), 0) from priced p))
             and u.kyc_status <> 'verified'
        from public.profiles u where u.id = (select auth.uid())), false)
  );
$$;

-- Checkout: the whole cart becomes ONE order (one reference, one receipt,
-- one invoice) in one transaction, then the cart is emptied. The page sends
-- only the total it showed (consent); every line is re-read, re-priced and
-- re-validated here and by the order triggers.
create function public.checkout_cart(p_idempotency_key uuid, p_expected_total_sdg numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_order public.orders;
  v_lines record;
  v_items jsonb;
  v_ids uuid[];
  v_live numeric;
  v_unavailable uuid[];
  v_msg text;
  v_reason text;
  v_line integer;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    return jsonb_build_object('status', 'error', 'reason', 'invalid_input');
  end if;

  select * into v_order from public.orders
   where user_id = v_uid and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('status', 'created', 'id', v_order.id, 'reference', v_order.reference);
  end if;

  if (select count(*) from public.orders
       where user_id = v_uid and created_at > now() - interval '1 hour')
     >= (select s.order_rate_limit_per_hour from public.security_settings s where s.id) then
    return jsonb_build_object('status', 'error', 'reason', 'rate_limited');
  end if;

  -- Freeze the cart for this transaction (edits wait, and see the empty cart).
  perform pg_advisory_xact_lock(hashtextextended('cart:' || v_uid::text, 0));
  select array_agg(c.id order by c.created_at, c.id),
         jsonb_agg(jsonb_build_object('variant_id', c.variant_id, 'quantity', c.quantity,
                                      'fulfillment_data', c.fulfillment_data)
                   order by c.created_at, c.id),
         sum(private.live_total_sdg(c.variant_id, c.quantity)),
         array_agg(c.id order by c.created_at, c.id)
           filter (where private.live_total_sdg(c.variant_id, c.quantity) is null)
    into v_ids, v_items, v_live, v_unavailable
    from public.cart_items c where c.user_id = v_uid;
  if v_ids is null then
    return jsonb_build_object('status', 'error', 'reason', 'cart_empty');
  end if;
  if v_unavailable is not null then
    return jsonb_build_object('status', 'error', 'reason', 'variant_unavailable',
                              'lines', to_jsonb(v_unavailable));
  end if;
  if p_expected_total_sdg is distinct from v_live then
    return jsonb_build_object('status', 'price_changed', 'total_sdg', v_live);
  end if;

  begin
    v_order := private.insert_order(v_uid, v_items, p_idempotency_key);
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
        return jsonb_build_object('status', 'price_changed', 'total_sdg',
          (select sum(private.live_total_sdg(c.variant_id, c.quantity))
             from public.cart_items c where c.user_id = v_uid));
      end if;
      v_reason := private.order_error_reason(v_msg);
      if v_reason is null then
        raise;
      end if;
      v_line := private.order_error_line(v_msg);
      return jsonb_build_object('status', 'error', 'reason', v_reason) ||
        case when v_line is not null
             then jsonb_build_object('lines', jsonb_build_array(v_ids[v_line]))
             else '{}'::jsonb end;
  end;

  delete from public.cart_items c where c.id = any (v_ids);
  return jsonb_build_object('status', 'created', 'id', v_order.id, 'reference', v_order.reference);
end;
$$;

-- 8. Readers that showed the single line -----------------------------------------
-- RLS: a line is visible wherever its order is (own orders, orders staff).
alter table public.order_items enable row level security;
grant select on public.order_items to authenticated;
create policy order_items_select on public.order_items
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));

drop function public.admin_orders(text, date, date, text, numeric, numeric, boolean, integer, integer);
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
  item_count integer,
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
    v_digits := nullif(ltrim(regexp_replace(v_q, '[^0-9]', '', 'g'), '0'), '');
    if char_length(coalesce(v_digits, '')) < 4 then
      v_digits := null;
    end if;
    v_txn := upper(regexp_replace(v_q, '[[:space:]-]+', '', 'g'));
  end if;

  -- First line's names for the list; item_count says how many more.
  return query
  select o.id, o.reference, o.status, o.created_at, o.total_sdg,
         (select count(*)::integer from public.order_items i where i.order_id = o.id),
         f.product_name_ar, f.product_name_en, f.variant_name_ar, f.variant_name_en,
         p.full_name, p.phone_e164,
         exists (select 1 from public.payment_receipts r
                  where r.order_id = o.id and r.status = 'pending'),
         count(*) over ()
    from public.orders o
    join public.profiles p on p.id = o.user_id
    left join public.order_items f on f.order_id = o.id and f.line_no = 1
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

-- Invoices issued from now on carry the lines. Invoices already issued keep
-- their single-line snapshot untouched (immutable); the site reads both.
create or replace function private.invoices_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_year integer;
  v_number integer;
begin
  select o.*, p.full_name as customer_name, p.phone_e164 as customer_phone
    into v_order
    from public.orders o
    join public.profiles p on p.id = o.user_id
   where o.id = new.order_id
     for update of o;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_order.status <> 'completed' then
    raise exception 'ORDER_NOT_COMPLETED' using errcode = 'P0001';
  end if;

  v_year := extract(year from (now() at time zone 'Africa/Khartoum'))::integer;
  insert into private.invoice_counters as c (year, last_value)
  values (v_year, 1)
  on conflict (year) do update set last_value = c.last_value + 1
  returning c.last_value into v_number;

  new.invoice_number := 'INV-' || v_year || '-' || lpad(v_number::text, 5, '0');
  new.status := 'issued';
  new.issued_at := now();
  new.issued_by := (select auth.uid());
  new.void_reason := null;
  new.voided_by := null;
  new.voided_at := null;
  new.total_usd := v_order.total_usd;
  new.usd_sdg_rate := v_order.usd_sdg_rate;
  new.total_sdg := v_order.total_sdg;
  new.snapshot := jsonb_build_object(
    'order', jsonb_build_object(
      'reference', v_order.reference,
      'created_at', v_order.created_at,
      'completed_at', v_order.completed_at,
      'total_usd', v_order.total_usd,
      'usd_sdg_rate', v_order.usd_sdg_rate,
      'total_sdg', v_order.total_sdg
    ),
    'items', (
      select jsonb_agg(jsonb_build_object(
        'line_no', i.line_no,
        'product_name_ar', i.product_name_ar,
        'product_name_en', i.product_name_en,
        'variant_name_ar', i.variant_name_ar,
        'variant_name_en', i.variant_name_en,
        'quantity', i.quantity,
        'unit_price_usd', i.unit_price_usd,
        'line_total_usd', i.line_total_usd,
        'line_total_sdg', i.line_total_sdg) order by i.line_no)
        from public.order_items i where i.order_id = v_order.id
    ),
    'customer', jsonb_build_object(
      'full_name', v_order.customer_name,
      'phone', v_order.customer_phone
    ),
    'seller', (
      select jsonb_build_object(
        'name_ar', s.business_name_ar,
        'name_en', s.business_name_en,
        'contact_phone', s.contact_phone,
        'contact_email', s.contact_email,
        'address_ar', s.address_ar,
        'address_en', s.address_en
      ) from public.app_settings s where s.id
    ),
    'payment', (
      select jsonb_build_object(
        'bank_name_ar', b.bank_name_ar,
        'bank_name_en', b.bank_name_en,
        'transaction_ref', r.transaction_ref,
        'accepted_at', r.reviewed_at
      )
        from public.payment_receipts r
        join public.bank_accounts b on b.id = r.bank_account_id
       where r.order_id = v_order.id and r.status = 'accepted'
       order by r.reviewed_at desc nulls last
       limit 1
    )
  );
  return new;
end;
$$;

-- Search result names come from the first line (new snapshots) or the single
-- line (snapshots issued before this migration); item_count for "+N".
drop function public.search_invoices(text, public.invoice_status, date, date, integer, integer, boolean);
create function public.search_invoices(
  p_query text default null,
  p_status public.invoice_status default null,
  p_from date default null,
  p_to date default null,
  p_limit integer default 50,
  p_offset integer default 0,
  p_mine boolean default false
)
returns table (
  id uuid,
  invoice_number text,
  order_id uuid,
  order_reference text,
  status public.invoice_status,
  issued_at timestamptz,
  customer_name text,
  customer_phone text,
  product_name_ar text,
  product_name_en text,
  item_count integer,
  total_sdg numeric,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select nullif(btrim(coalesce(p_query, '')), '') as text,
           nullif(regexp_replace(coalesce(p_query, ''), '[^0-9]', '', 'g'), '') as digits
  )
  select i.id, i.invoice_number, i.order_id, i.snapshot #>> '{order,reference}', i.status, i.issued_at,
         i.snapshot #>> '{customer,full_name}', i.snapshot #>> '{customer,phone}',
         coalesce(i.snapshot #>> '{items,0,product_name_ar}', i.snapshot #>> '{order,product_name_ar}'),
         coalesce(i.snapshot #>> '{items,0,product_name_en}', i.snapshot #>> '{order,product_name_en}'),
         coalesce(jsonb_array_length(i.snapshot -> 'items'), 1),
         i.total_sdg, count(*) over ()
    from public.invoices i, q
   where (q.text is null
          or i.invoice_number ilike '%' || q.text || '%'
          or (i.snapshot #>> '{order,reference}') ilike '%' || q.text || '%'
          or private.normalize_ar(i.snapshot #>> '{customer,full_name}') like '%' || private.normalize_ar(q.text) || '%'
          or (char_length(q.digits) >= 6
              and (i.snapshot #>> '{customer,phone}') like '%' || right(q.digits, 9) || '%'))
     and (p_status is null or i.status = p_status)
     and (not p_mine or (i.status = 'issued' and exists (
           select 1 from public.orders o where o.id = i.order_id and o.user_id = (select auth.uid()))))
     and (p_from is null or i.issued_at >= (p_from::timestamp at time zone 'Africa/Khartoum'))
     and (p_to is null or i.issued_at < ((p_to + 1)::timestamp at time zone 'Africa/Khartoum'))
   order by i.issued_at desc, i.invoice_number desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- 9. Grants ------------------------------------------------------------------------
revoke execute on function private.kyc_window_total_usd(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.kyc_required_for(uuid, uuid, numeric) from public, anon, authenticated;
revoke execute on function private.assert_order_complete(uuid) from public, anon, authenticated;
revoke execute on function private.insert_order(uuid, jsonb, uuid, uuid) from public, anon, authenticated;
revoke execute on function private.order_error_reason(text) from public, anon, authenticated;
revoke execute on function private.order_error_line(text) from public, anon, authenticated;
revoke execute on function public.service_create_order(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.service_create_order(uuid, jsonb, uuid) to service_role;
revoke execute on function public.my_cart() from public, anon;
grant execute on function public.my_cart() to authenticated;
revoke execute on function public.checkout_cart(uuid, numeric) from public, anon;
grant execute on function public.checkout_cart(uuid, numeric) to authenticated;
revoke execute on function public.admin_orders(text, date, date, text, numeric, numeric, boolean, integer, integer) from public, anon;
grant execute on function public.admin_orders(text, date, date, text, numeric, numeric, boolean, integer, integer) to authenticated;
revoke execute on function public.search_invoices(text, public.invoice_status, date, date, integer, integer, boolean) from public, anon;
grant execute on function public.search_invoices(text, public.invoice_status, date, date, integer, integer, boolean) to authenticated;
