-- Invoices: gapless yearly numbering and an immutable snapshot copied from the
-- order at issue time. Totals are never recomputed from current prices.

create table private.invoice_counters (
  year integer primary key check (year between 2020 and 2200),
  last_value integer not null check (last_value >= 0)
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique check (invoice_number ~ '^INV-[0-9]{4}-[0-9]{5,}$'),
  order_id uuid not null references public.orders (id) on delete restrict,
  status public.invoice_status not null default 'issued',
  issued_at timestamptz not null default now(),
  issued_by uuid default auth.uid() references public.profiles (id),
  total_usd numeric(12, 2) not null,
  usd_sdg_rate numeric(14, 4) not null,
  total_sdg numeric(16, 2) not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  void_reason text check (char_length(void_reason) <= 500),
  voided_by uuid references public.profiles (id),
  voided_at timestamptz,
  check ((status = 'void') = (voided_at is not null)),
  check (status <> 'void' or void_reason is not null)
);

create unique index invoices_one_issued_per_order on public.invoices (order_id) where status = 'issued';
create index invoices_issued_at on public.invoices (issued_at desc);
create index invoices_order on public.invoices (order_id);

create function private.invoices_before_insert()
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

  -- Gapless: the counter row is updated inside this transaction, so a failed
  -- insert rolls the number back (a sequence would leave a gap).
  v_year := extract(year from (now() at time zone 'Africa/Khartoum'))::integer;
  insert into private.invoice_counters as c (year, last_value)
  values (v_year, 1)
  on conflict (year) do update set last_value = c.last_value + 1
  returning c.last_value into v_number;

  new.invoice_number := 'INV-' || v_year || '-' || lpad(v_number::text, 5, '0');
  new.status := 'issued';
  new.issued_at := now();
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
      'product_name_ar', v_order.product_name_ar,
      'product_name_en', v_order.product_name_en,
      'variant_name_ar', v_order.variant_name_ar,
      'variant_name_en', v_order.variant_name_en,
      'quantity', v_order.quantity,
      'unit_price_usd', v_order.unit_price_usd,
      'total_usd', v_order.total_usd,
      'usd_sdg_rate', v_order.usd_sdg_rate,
      'total_sdg', v_order.total_sdg
    ),
    'customer', jsonb_build_object(
      'full_name', v_order.customer_name,
      'phone', v_order.customer_phone
    ),
    'seller', (
      select jsonb_build_object(
        'contact_phone', s.contact_phone,
        'contact_email', s.contact_email,
        'address_ar', s.address_ar,
        'address_en', s.address_en
      ) from public.app_settings s where s.id
    ),
    'bank_accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'bank_name_ar', b.bank_name_ar,
        'bank_name_en', b.bank_name_en,
        'account_number', b.account_number,
        'account_holder', b.account_holder
      ) order by b.sort_order)
      from public.bank_accounts b where b.is_active
    ), '[]'::jsonb)
  );
  return new;
end;
$$;

create trigger invoices_before_insert
  before insert on public.invoices
  for each row execute function private.invoices_before_insert();

-- Issued invoices are immutable. The only permitted change is issued → void
-- with a reason; corrections are a new invoice with a new number.
create function private.invoices_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  c_void_cols constant text[] := array['status', 'void_reason', 'voided_by', 'voided_at'];
begin
  if (to_jsonb(new) - c_void_cols) is distinct from (to_jsonb(old) - c_void_cols) then
    raise exception 'INVOICE_IMMUTABLE' using errcode = '42501';
  end if;
  if old.status = 'void' then
    raise exception 'INVOICE_IMMUTABLE: already void' using errcode = '42501';
  end if;
  if new.status = 'void' then
    if new.void_reason is null then
      raise exception 'VOID_REASON_REQUIRED' using errcode = 'P0001';
    end if;
    new.voided_at := now();
    new.voided_by := (select auth.uid());
  end if;
  return new;
end;
$$;

create trigger invoices_before_update
  before update on public.invoices
  for each row execute function private.invoices_before_update();

create trigger invoices_no_delete
  before delete on public.invoices
  for each row execute function private.forbid_delete();
