-- Orders, status machine, receipts.
-- Rule: every money/snapshot field on an order is DERIVED by the BEFORE INSERT
-- trigger from the database. Values supplied by any caller (browser, server,
-- even service_role) are overwritten, and are immutable afterwards.

create table public.order_statuses (
  code text primary key check (code ~ '^[a-z_]+$'),
  name_ar text not null,
  name_en text not null,
  is_terminal boolean not null default false,
  notify_customer boolean not null default true,
  sort_order integer not null default 0
);

insert into public.order_statuses (code, name_ar, name_en, is_terminal, sort_order) values
  ('new', 'جديد', 'New', false, 0),
  ('processing', 'قيد التنفيذ', 'Processing', false, 1),
  ('completed', 'مكتمل', 'Completed', true, 2),
  ('cancelled', 'ملغي', 'Cancelled', true, 3);

create table public.order_status_transitions (
  from_status text not null references public.order_statuses (code),
  to_status text not null references public.order_statuses (code),
  primary key (from_status, to_status),
  check (from_status <> to_status)
);

insert into public.order_status_transitions (from_status, to_status) values
  ('new', 'processing'),
  ('new', 'cancelled'),
  ('processing', 'completed'),
  ('processing', 'cancelled');

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique check (reference ~ '^FD-[0-9]{7}$'),
  user_id uuid not null references public.profiles (id) on delete restrict,
  variant_id uuid not null references public.product_variants (id) on delete restrict,
  status text not null default 'new' references public.order_statuses (code),
  -- Immutable snapshot (derived by trigger).
  product_name_ar text,
  product_name_en text,
  variant_name_ar text,
  variant_name_en text,
  quantity smallint not null check (quantity between 1 and 10),
  unit_price_usd numeric(12, 2) not null check (unit_price_usd > 0),
  total_usd numeric(12, 2) not null,
  usd_sdg_rate numeric(14, 4) not null check (usd_sdg_rate > 0),
  total_sdg numeric(16, 2) not null,
  kyc_required boolean not null,
  fulfillment_fields jsonb not null default '[]' check (jsonb_typeof(fulfillment_fields) = 'array'),
  fulfillment_data jsonb not null default '{}' check (jsonb_typeof(fulfillment_data) = 'object'),
  idempotency_key uuid not null,
  customer_note text check (char_length(customer_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  unique (user_id, idempotency_key),
  constraint orders_total_usd_formula check (total_usd = unit_price_usd * quantity),
  -- SDG charge is rounded UP to whole pounds: the owner never under-collects,
  -- and customers transfer whole amounts (easy to match against receipts).
  constraint orders_total_sdg_formula check (total_sdg = ceil(total_usd * usd_sdg_rate))
);

create index orders_user_created on public.orders (user_id, created_at desc);
create index orders_status_created on public.orders (status, created_at desc);
create index orders_created on public.orders (created_at desc);
create index orders_variant on public.orders (variant_id);

create function private.orders_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_variant record;
  v_settings record;
  v_customer record;
  v_bytes bytea;
  v_attempt integer := 0;
begin
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
    raise exception 'VARIANT_UNAVAILABLE' using errcode = 'P0001';
  end if;

  select s.usd_sdg_rate, s.kyc_threshold_usd into v_settings
    from public.app_settings s where s.id;
  if v_settings.usd_sdg_rate is null or v_settings.kyc_threshold_usd is null then
    raise exception 'PRICING_NOT_CONFIGURED' using errcode = 'P0001';
  end if;

  select p.kyc_status, p.is_blocked, p.phone_verified_at into v_customer
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

  if new.quantity is null or new.quantity < 1 or new.quantity > v_variant.max_quantity then
    raise exception 'INVALID_QUANTITY' using errcode = 'P0001';
  end if;

  -- Derive the snapshot. Whatever the caller sent for these is discarded.
  new.product_name_ar := v_variant.product_ar;
  new.product_name_en := v_variant.product_en;
  new.variant_name_ar := v_variant.variant_ar;
  new.variant_name_en := v_variant.variant_en;
  new.unit_price_usd := v_variant.price_usd;
  new.total_usd := v_variant.price_usd * new.quantity;
  new.usd_sdg_rate := v_settings.usd_sdg_rate;
  new.total_sdg := ceil(new.total_usd * v_settings.usd_sdg_rate);
  new.kyc_required := new.total_usd >= v_settings.kyc_threshold_usd;
  new.fulfillment_fields := v_variant.required_fields;
  new.status := 'new';
  new.created_at := now();
  new.updated_at := now();
  new.completed_at := null;
  new.cancelled_at := null;

  -- KYC threshold is enforced here, for every insert path (decisions.md: USD).
  if new.kyc_required and v_customer.kyc_status <> 'verified' then
    raise exception 'KYC_REQUIRED' using errcode = 'P0001';
  end if;

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

create trigger orders_before_insert
  before insert on public.orders
  for each row execute function private.orders_before_insert();

create function private.orders_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  c_mutable constant text[] := array[
    'status', 'updated_at', 'completed_at', 'cancelled_at', 'fulfillment_data'
  ];
begin
  if (to_jsonb(new) - c_mutable) is distinct from (to_jsonb(old) - c_mutable) then
    raise exception 'ORDER_SNAPSHOT_IMMUTABLE' using errcode = '42501';
  end if;

  -- Fulfillment data may only be changed (purged) once the order is final.
  if new.fulfillment_data is distinct from old.fulfillment_data
     and not exists (select 1 from public.order_statuses s
                      where s.code = new.status and s.is_terminal) then
    raise exception 'FULFILLMENT_DATA_LOCKED' using errcode = '42501';
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

create trigger orders_before_update
  before update on public.orders
  for each row execute function private.orders_before_update();

create function private.forbid_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'PERMANENT_RECORD: rows in % cannot be deleted', tg_table_name
    using errcode = '42501';
end;
$$;

create trigger orders_no_delete
  before delete on public.orders
  for each row execute function private.forbid_delete();

create table public.order_status_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete restrict,
  from_status text references public.order_statuses (code),
  to_status text not null references public.order_statuses (code),
  changed_by uuid references public.profiles (id),
  customer_note text check (char_length(customer_note) <= 500),
  created_at timestamptz not null default now()
);

create index order_status_history_order on public.order_status_history (order_id, created_at);

create function private.orders_record_status()
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
     where p.id = (select pv.product_id from public.product_variants pv where pv.id = new.variant_id);
  end if;
  return null;
end;
$$;

create trigger orders_record_status_insert
  after insert on public.orders
  for each row execute function private.orders_record_status();

create trigger orders_record_status_update
  after update of status on public.orders
  for each row when (old.status is distinct from new.status)
  execute function private.orders_record_status();

create table public.order_internal_notes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  author_id uuid not null default auth.uid() references public.profiles (id),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index order_internal_notes_order on public.order_internal_notes (order_id, created_at);

create table public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  bank_account_id uuid not null references public.bank_accounts (id) on delete restrict,
  transaction_ref text not null check (char_length(btrim(transaction_ref)) between 3 and 64),
  transaction_ref_norm text generated always as (
    upper(regexp_replace(transaction_ref, '[[:space:]-]+', '', 'g'))
  ) stored,
  amount_claimed_sdg numeric(16, 2) check (amount_claimed_sdg > 0),
  transferred_at timestamptz,
  storage_path text not null,
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  status public.review_status not null default 'pending',
  rejection_reason text check (char_length(rejection_reason) <= 500),
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'rejected' or rejection_reason is not null),
  check ((status = 'pending') = (reviewed_at is null))
);

-- Duplicate transfer detection (decisions.md): the same transaction number
-- for the same bank cannot back two live receipts.
create unique index payment_receipts_txn_unique
  on public.payment_receipts (bank_account_id, transaction_ref_norm)
  where status <> 'rejected';
create unique index payment_receipts_one_pending
  on public.payment_receipts (order_id) where status = 'pending';
create index payment_receipts_order on public.payment_receipts (order_id);
create index payment_receipts_user on public.payment_receipts (user_id, created_at desc);
create index payment_receipts_sha256 on public.payment_receipts (file_sha256);
create index payment_receipts_queue on public.payment_receipts (status, created_at);

-- A receipt always belongs to the order's customer, never to the caller's claim.
create function private.payment_receipts_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select o.user_id into new.user_id from public.orders o where o.id = new.order_id;
  if new.user_id is null then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  new.status := 'pending';
  new.reviewed_by := null;
  new.reviewed_at := null;
  new.rejection_reason := null;
  return new;
end;
$$;

create trigger payment_receipts_before_insert
  before insert on public.payment_receipts
  for each row execute function private.payment_receipts_before_insert();

create trigger payment_receipts_set_updated_at
  before update on public.payment_receipts
  for each row execute function private.set_updated_at();

create trigger payment_receipts_no_delete
  before delete on public.payment_receipts
  for each row execute function private.forbid_delete();
