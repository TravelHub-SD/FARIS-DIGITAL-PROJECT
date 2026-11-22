-- Custom-amount products (client feedback item 6, decisions.md 2026-11-21).
--
-- A product is either "package" (fixed-price variants, as before) or
-- "custom_amount" (e.g. "Pay a bill with Visa"): the customer types an amount
-- in a foreign currency, the SDG price is amount × the currency's rate plus
-- the product's fee, rounded up to whole pounds per line (the existing rule).
--
-- * Every business choice the client has not made yet is a setting with a
--   safe default: currencies and their rates (settings staff), and per
--   product the allowed currencies, min/max per currency, decimals and fee
--   (default 0). A new custom-amount product sells nothing until settings
--   staff allow a currency for it.
-- * Money stays derived by the database only. The cart holds the product,
--   the amount, the currency and the details, never a price;
--   private.custom_amount_quote() is the one formula, used by the cart
--   trigger, the cart reader, checkout and the order-line trigger, which
--   re-reads the rate, the limits and the fee and validates the amount.
-- * The order line keeps amount, currency, rate, fee and SDG total as its
--   snapshot (CHECKed formulas); later rate or fee changes never touch it.
-- * KYC is unchanged: each line carries a USD value (custom lines: SDG total
--   ÷ the order's USD rate, rounded up to the cent) and the threshold and
--   rolling window apply to the order total as before.
-- * USD in the currency list is the store's USD rate (app_settings), kept in
--   step by trigger: one dollar never has two prices.

-- 1. Currencies -----------------------------------------------------------------
create table public.currencies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z]{3}$'),
  name_ar text not null check (char_length(name_ar) between 1 and 40),
  name_en text not null check (char_length(name_en) between 1 and 40),
  symbol text not null check (char_length(symbol) between 1 and 8),
  -- SDG per 1 unit, entered by hand.
  sdg_rate numeric(14, 4) not null check (sdg_rate > 0),
  rate_updated_at timestamptz not null default now(),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function private.currencies_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.code := old.code;
    new.created_at := old.created_at;
  else
    new.created_at := now();
  end if;
  -- USD follows the store's USD rate (Settings › Pricing), whatever was sent.
  if new.code = 'USD' then
    select s.usd_sdg_rate into new.sdg_rate from public.app_settings s where s.id;
    if new.sdg_rate is null then
      raise exception 'USD_RATE_NOT_SET' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'INSERT' or new.sdg_rate is distinct from old.sdg_rate then
    new.rate_updated_at := now();
  else
    new.rate_updated_at := old.rate_updated_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger currencies_before_write
  before insert or update on public.currencies
  for each row execute function private.currencies_before_write();

create trigger audit_currencies
  after insert or update or delete on public.currencies
  for each row execute function private.audit_row();

-- The store's USD rate changes → the USD currency row follows (audited there
-- too, as the admin who changed the rate).
create function private.app_settings_sync_usd()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.currencies set sdg_rate = new.usd_sdg_rate where code = 'USD';
  return null;
end;
$$;

create trigger app_settings_sync_usd
  after update of usd_sdg_rate on public.app_settings
  for each row when (new.usd_sdg_rate is distinct from old.usd_sdg_rate and new.usd_sdg_rate is not null)
  execute function private.app_settings_sync_usd();

alter table public.currencies enable row level security;
grant select on public.currencies to anon, authenticated;
-- No delete: a currency is disabled, so past carts and settings stay legible.
grant insert (code, name_ar, name_en, symbol, sdg_rate, is_active, sort_order),
      update (name_ar, name_en, symbol, sdg_rate, is_active, sort_order)
  on public.currencies to authenticated;
create policy currencies_select on public.currencies
  for select to anon, authenticated
  using (is_active or (select private.has_permission('settings')));
create policy currencies_insert on public.currencies
  for insert to authenticated with check ((select private.has_permission('settings')));
create policy currencies_update on public.currencies
  for update to authenticated
  using ((select private.has_permission('settings')))
  with check ((select private.has_permission('settings')));

-- 2. Product kind -----------------------------------------------------------------
alter table public.products
  add column kind text not null default 'package' check (kind in ('package', 'custom_amount'));
-- Chosen when the product is created; never changed (a product is one or the
-- other, never both).
grant insert (kind) on public.products to authenticated;

create function private.products_kind_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind is distinct from old.kind then
    raise exception 'PRODUCT_KIND_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger products_kind_immutable
  before update on public.products
  for each row execute function private.products_kind_immutable();

-- Packages (variants) only on package products.
create function private.product_variants_kind_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.products p where p.id = new.product_id and p.kind = 'package') then
    raise exception 'PRODUCT_KIND_MISMATCH' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger product_variants_kind_check
  before insert or update of product_id on public.product_variants
  for each row execute function private.product_variants_kind_check();

-- 3. Per-product settings ---------------------------------------------------------
create table public.custom_amount_products (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references public.products (id) on delete cascade,
  amount_decimals smallint not null default 2 check (amount_decimals between 0 and 3),
  fee_percent numeric(5, 2) not null default 0 check (fee_percent between 0 and 100),
  fee_fixed_sdg numeric(12, 2) not null default 0 check (fee_fixed_sdg between 0 and 100000000),
  required_fields jsonb not null default '[]'
    constraint custom_amount_products_required_fields_valid
    check (private.valid_field_definitions(required_fields)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger custom_amount_products_set_updated_at
  before update on public.custom_amount_products
  for each row execute function private.set_updated_at();
create trigger audit_custom_amount_products
  after insert or update or delete on public.custom_amount_products
  for each row execute function private.audit_row();

create function private.custom_amount_products_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.product_id := old.product_id;
    new.created_at := old.created_at;
  elsif not exists (select 1 from public.products p
                     where p.id = new.product_id and p.kind = 'custom_amount') then
    raise exception 'PRODUCT_KIND_MISMATCH' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger custom_amount_products_before_write
  before insert or update on public.custom_amount_products
  for each row execute function private.custom_amount_products_before_write();

-- Every custom-amount product gets its settings row (safe defaults: two
-- decimals, no fee, no currency allowed yet) when it is created.
create function private.products_create_custom_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.custom_amount_products (product_id) values (new.id);
  return null;
end;
$$;

create trigger products_create_custom_settings
  after insert on public.products
  for each row when (new.kind = 'custom_amount')
  execute function private.products_create_custom_settings();

-- Allowed currencies and their limits, per product.
create table public.custom_amount_currencies (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.custom_amount_products (product_id) on delete cascade,
  currency_code text not null references public.currencies (code) on delete restrict,
  min_amount numeric(14, 3) not null check (min_amount > 0),
  max_amount numeric(14, 3) not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, currency_code),
  check (max_amount >= min_amount)
);

create function private.custom_amount_currencies_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.id := old.id;
  new.product_id := old.product_id;
  new.currency_code := old.currency_code;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

create trigger custom_amount_currencies_before_update
  before update on public.custom_amount_currencies
  for each row execute function private.custom_amount_currencies_before_update();
create trigger audit_custom_amount_currencies
  after insert or update or delete on public.custom_amount_currencies
  for each row execute function private.audit_row();

-- Public read of what a visible product offers; settings staff write.
alter table public.custom_amount_products enable row level security;
alter table public.custom_amount_currencies enable row level security;
grant select on public.custom_amount_products, public.custom_amount_currencies to anon, authenticated;
grant update (amount_decimals, fee_percent, fee_fixed_sdg, required_fields)
  on public.custom_amount_products to authenticated;
grant insert (product_id, currency_code, min_amount, max_amount, sort_order),
      update (min_amount, max_amount, sort_order),
      delete
  on public.custom_amount_currencies to authenticated;

create policy custom_amount_products_select on public.custom_amount_products
  for select to anon, authenticated
  using (exists (select 1 from public.products p where p.id = product_id)
         or (select private.has_permission('settings')));
create policy custom_amount_products_update on public.custom_amount_products
  for update to authenticated
  using ((select private.has_permission('settings')))
  with check ((select private.has_permission('settings')));

create policy custom_amount_currencies_select on public.custom_amount_currencies
  for select to anon, authenticated
  using (exists (select 1 from public.custom_amount_products c where c.product_id = custom_amount_currencies.product_id)
         or (select private.has_permission('settings')));
create policy custom_amount_currencies_insert on public.custom_amount_currencies
  for insert to authenticated with check ((select private.has_permission('settings')));
create policy custom_amount_currencies_update on public.custom_amount_currencies
  for update to authenticated
  using ((select private.has_permission('settings')))
  with check ((select private.has_permission('settings')));
create policy custom_amount_currencies_delete on public.custom_amount_currencies
  for delete to authenticated using ((select private.has_permission('settings')));

-- 4. The formula --------------------------------------------------------------------
-- Price of `p_amount` units of `p_currency` for a custom-amount product, from
-- the database's own rate, limits and fee. `error` is set (and no price
-- returned) when the product is not orderable, the currency is not allowed
-- or disabled, or the amount is zero, negative, has too many decimals or is
-- outside the limits. The USD value (for KYC) uses `p_usd_rate`, else the
-- store's current USD rate.
--   base  = amount × rate
--   fee   = round(base × fee% / 100, 2) + fixed fee
--   total = ceil(base + fee)                        (whole pounds, per line)
--   usd   = ceil(total × 100 / USD rate) / 100      (rounded up to the cent)
create function private.custom_amount_quote(
  p_product_id uuid,
  p_currency text,
  p_amount numeric,
  p_usd_rate numeric default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg record;
  v_cur record;
  v_usd numeric;
  v_amount numeric := trim_scale(p_amount);
  v_base numeric;
  v_fee numeric;
  v_total numeric;
begin
  select pr.name_ar, pr.name_en, cfg.amount_decimals, cfg.fee_percent, cfg.fee_fixed_sdg,
         cfg.required_fields
    into v_cfg
    from public.products pr
    join public.categories c on c.id = pr.category_id
    join public.custom_amount_products cfg on cfg.product_id = pr.id
   where pr.id = p_product_id and pr.kind = 'custom_amount'
     and pr.is_active and pr.archived_at is null
     and c.is_active and c.archived_at is null;
  if not found then
    return jsonb_build_object('error', 'PRODUCT_UNAVAILABLE');
  end if;

  select cu.code, cu.name_ar, cu.name_en, cu.symbol, cu.sdg_rate, cc.min_amount, cc.max_amount
    into v_cur
    from public.custom_amount_currencies cc
    join public.currencies cu on cu.code = cc.currency_code
   where cc.product_id = p_product_id and cc.currency_code = p_currency
     and cu.is_active;
  if not found then
    return jsonb_build_object('error', 'CURRENCY_UNAVAILABLE');
  end if;

  v_usd := coalesce(p_usd_rate, (select s.usd_sdg_rate from public.app_settings s where s.id));
  if v_usd is null then
    return jsonb_build_object('error', 'PRICING_NOT_CONFIGURED');
  end if;
  if v_amount is null or v_amount <= 0 then
    return jsonb_build_object('error', 'AMOUNT_INVALID');
  end if;
  if scale(v_amount) > v_cfg.amount_decimals then
    return jsonb_build_object('error', 'AMOUNT_DECIMALS');
  end if;
  if v_amount < v_cur.min_amount then
    return jsonb_build_object('error', 'AMOUNT_BELOW_MIN');
  end if;
  if v_amount > v_cur.max_amount then
    return jsonb_build_object('error', 'AMOUNT_ABOVE_MAX');
  end if;

  v_base := v_amount * v_cur.sdg_rate;
  v_fee := round(v_base * v_cfg.fee_percent / 100, 2) + v_cfg.fee_fixed_sdg;
  v_total := ceil(v_base + v_fee);
  return jsonb_build_object(
    'error', null,
    'product_name_ar', v_cfg.name_ar,
    'product_name_en', v_cfg.name_en,
    'amount', v_amount,
    'decimals', v_cfg.amount_decimals,
    'currency_code', v_cur.code,
    'currency_name_ar', v_cur.name_ar,
    'currency_name_en', v_cur.name_en,
    'currency_symbol', v_cur.symbol,
    'rate', v_cur.sdg_rate,
    'fee_percent', v_cfg.fee_percent,
    'fee_fixed_sdg', v_cfg.fee_fixed_sdg,
    'fee_sdg', v_fee,
    'total_sdg', v_total,
    'total_usd', ceil(v_total * 100 / v_usd) / 100,
    'required_fields', v_cfg.required_fields
  );
end;
$$;

-- 5. Order lines --------------------------------------------------------------------
alter table public.order_items
  alter column variant_id drop not null,
  add column kind text not null default 'package' check (kind in ('package', 'custom_amount')),
  add column product_id uuid references public.products (id) on delete restrict,
  add column amount numeric,
  add column currency_code text,
  add column currency_name_ar text,
  add column currency_name_en text,
  add column currency_symbol text,
  add column currency_rate_sdg numeric(14, 4),
  add column fee_percent numeric(5, 2),
  add column fee_fixed_sdg numeric(12, 2),
  add column fee_sdg numeric(16, 2),
  -- The per-line SDG formula of a package line; a custom line has its own.
  drop constraint order_items_total_sdg_formula,
  add constraint order_items_total_sdg_formula
    check (kind <> 'package' or line_total_sdg = ceil(line_total_usd * usd_sdg_rate)),
  add constraint order_items_kind_shape check (
    (kind = 'package' and variant_id is not null and amount is null and currency_code is null
       and currency_rate_sdg is null and fee_sdg is null)
    or (kind = 'custom_amount' and variant_id is null and product_id is not null and quantity = 1
       and amount > 0 and scale(amount) <= 3 and currency_code ~ '^[A-Z]{3}$'
       and currency_rate_sdg > 0 and fee_percent between 0 and 100 and fee_fixed_sdg >= 0
       and fee_sdg is not null)),
  add constraint order_items_custom_formula check (
    kind <> 'custom_amount'
    or (fee_sdg = round(amount * currency_rate_sdg * fee_percent / 100, 2) + fee_fixed_sdg
        and line_total_sdg = ceil(amount * currency_rate_sdg + fee_sdg)
        and line_total_usd = ceil(line_total_sdg * 100 / usd_sdg_rate) / 100));

create index order_items_product on public.order_items (product_id);

-- Package lines as before (now also recording their product); custom lines
-- priced by the quote at the moment the order is created. Whatever the
-- caller sent for any money or snapshot column is discarded.
create or replace function private.order_items_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_variant record;
  v_quote jsonb;
  v_fields jsonb;
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

  if new.variant_id is not null then
    select pv.price_usd, pv.max_quantity, pv.required_fields, pr.id as product_id,
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
    v_fields := v_variant.required_fields;

    new.kind := 'package';
    new.product_id := v_variant.product_id;
    new.product_name_ar := v_variant.product_ar;
    new.product_name_en := v_variant.product_en;
    new.variant_name_ar := v_variant.variant_ar;
    new.variant_name_en := v_variant.variant_en;
    new.unit_price_usd := v_variant.price_usd;
    new.line_total_usd := v_variant.price_usd * new.quantity;
    new.usd_sdg_rate := v_order.usd_sdg_rate;
    new.line_total_sdg := ceil(new.line_total_usd * v_order.usd_sdg_rate);
    new.amount := null;
    new.currency_code := null;
    new.currency_name_ar := null;
    new.currency_name_en := null;
    new.currency_symbol := null;
    new.currency_rate_sdg := null;
    new.fee_percent := null;
    new.fee_fixed_sdg := null;
    new.fee_sdg := null;
  else
    if new.quantity is distinct from 1 then
      raise exception 'INVALID_QUANTITY: line %', new.line_no using errcode = 'P0001';
    end if;
    v_quote := private.custom_amount_quote(new.product_id, new.currency_code, new.amount,
                                           v_order.usd_sdg_rate);
    if v_quote ->> 'error' is not null then
      raise exception '%: line %', v_quote ->> 'error', new.line_no using errcode = 'P0001';
    end if;
    v_fields := v_quote -> 'required_fields';

    new.kind := 'custom_amount';
    new.product_name_ar := v_quote ->> 'product_name_ar';
    new.product_name_en := v_quote ->> 'product_name_en';
    new.variant_name_ar := null;
    new.variant_name_en := null;
    new.amount := (v_quote ->> 'amount')::numeric;
    new.currency_code := v_quote ->> 'currency_code';
    new.currency_name_ar := v_quote ->> 'currency_name_ar';
    new.currency_name_en := v_quote ->> 'currency_name_en';
    new.currency_symbol := v_quote ->> 'currency_symbol';
    new.currency_rate_sdg := (v_quote ->> 'rate')::numeric;
    new.fee_percent := (v_quote ->> 'fee_percent')::numeric;
    new.fee_fixed_sdg := (v_quote ->> 'fee_fixed_sdg')::numeric;
    new.fee_sdg := (v_quote ->> 'fee_sdg')::numeric;
    new.line_total_sdg := (v_quote ->> 'total_sdg')::numeric;
    new.usd_sdg_rate := v_order.usd_sdg_rate;
    new.line_total_usd := (v_quote ->> 'total_usd')::numeric;
    new.unit_price_usd := new.line_total_usd;
  end if;

  v_errors := private.fulfillment_errors(v_fields, coalesce(new.fulfillment_data, '{}'::jsonb));
  if cardinality(v_errors) > 0 then
    raise exception 'FULFILLMENT_INVALID: line %: %', new.line_no, array_to_string(v_errors, ',')
      using errcode = 'P0001';
  end if;
  new.fulfillment_fields := v_fields;
  new.created_at := now();
  return new;
end;
$$;

-- "Most ordered" counts custom-amount products too.
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
     where p.id in (select coalesce(i.product_id, pv.product_id)
                      from public.order_items i
                      left join public.product_variants pv on pv.id = i.variant_id
                     where i.order_id = new.id);
  end if;
  return null;
end;
$$;

-- Items: [{variant_id, quantity, fulfillment_data}] for packages,
-- [{product_id, currency_code, amount, fulfillment_data}] for custom amounts.
-- Any other key (a price, a rate, a fee, a name) is ignored.
create or replace function private.insert_order(
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
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
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
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'VARIANT_UNAVAILABLE' using errcode = 'P0001';
    end if;
    if v_item ? 'variant_id' and v_item -> 'variant_id' <> 'null'::jsonb then
      if coalesce(v_item ->> 'variant_id', '') !~ v_uuid then
        raise exception 'VARIANT_UNAVAILABLE' using errcode = 'P0001';
      end if;
      if coalesce(v_item ->> 'quantity', '') !~ '^[0-9]{1,2}$' then
        raise exception 'INVALID_QUANTITY' using errcode = 'P0001';
      end if;
      insert into public.order_items (order_id, variant_id, quantity, fulfillment_data)
      values (v_order.id, (v_item ->> 'variant_id')::uuid, (v_item ->> 'quantity')::smallint,
              coalesce(v_item -> 'fulfillment_data', '{}'::jsonb));
    else
      if coalesce(v_item ->> 'product_id', '') !~ v_uuid then
        raise exception 'VARIANT_UNAVAILABLE' using errcode = 'P0001';
      end if;
      if coalesce(v_item ->> 'currency_code', '') !~ '^[A-Z]{3}$' then
        raise exception 'CURRENCY_UNAVAILABLE' using errcode = 'P0001';
      end if;
      if coalesce(v_item ->> 'amount', '') !~ '^[0-9]{1,15}(\.[0-9]{1,20})?$' then
        raise exception 'AMOUNT_INVALID' using errcode = 'P0001';
      end if;
      insert into public.order_items (order_id, product_id, currency_code, amount, quantity, fulfillment_data)
      values (v_order.id, (v_item ->> 'product_id')::uuid, v_item ->> 'currency_code',
              (v_item ->> 'amount')::numeric, 1, coalesce(v_item -> 'fulfillment_data', '{}'::jsonb));
    end if;
  end loop;

  perform private.assert_order_complete(v_order.id);
  select * into v_order from public.orders where id = v_order.id;
  return v_order;
end;
$$;

create or replace function private.order_error_reason(p_message text)
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
    when p_message like 'PRODUCT_UNAVAILABLE%' then 'variant_unavailable'
    when p_message like 'PRICING_NOT_CONFIGURED%' then 'variant_unavailable'
    when p_message like 'CURRENCY_UNAVAILABLE%' then 'currency_unavailable'
    when p_message like 'AMOUNT_%' then 'amount_invalid'
    when p_message like 'INVALID_QUANTITY%' then 'invalid_quantity'
    when p_message like 'FULFILLMENT_INVALID%' then 'fulfillment_invalid'
    when p_message in ('TOO_MANY_ITEMS', 'ORDER_HAS_NO_ITEMS') then 'invalid_input'
  end;
$$;

-- 6. Cart ---------------------------------------------------------------------------
alter table public.cart_items
  alter column variant_id drop not null,
  add column product_id uuid references public.products (id) on delete cascade,
  add column amount numeric,
  add column currency_code text references public.currencies (code) on delete cascade,
  add constraint cart_items_kind_shape check (
    (variant_id is not null and product_id is null and amount is null and currency_code is null)
    or (variant_id is null and product_id is not null and currency_code is not null and quantity = 1
        and amount > 0 and scale(amount) <= 3 and amount < 1000000000000));

-- The amount and currency of a line are fixed once added (remove and add
-- again to change them); details stay editable.
grant insert (product_id, amount, currency_code) on public.cart_items to authenticated;

create or replace function private.cart_items_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_variant record;
  v_quote jsonb;
  v_fields jsonb;
  v_errors text[];
begin
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
    new.variant_id := old.variant_id;
    new.product_id := old.product_id;
    new.amount := old.amount;
    new.currency_code := old.currency_code;
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

  if new.variant_id is not null then
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
    v_fields := v_variant.required_fields;
  else
    if new.quantity is distinct from 1 then
      raise exception 'INVALID_QUANTITY' using errcode = 'P0001';
    end if;
    v_quote := private.custom_amount_quote(new.product_id, new.currency_code, new.amount);
    if v_quote ->> 'error' is not null then
      raise exception '%', v_quote ->> 'error' using errcode = 'P0001';
    end if;
    -- Stored as validated (no trailing zeros): 56.50 → 56.5.
    new.amount := (v_quote ->> 'amount')::numeric;
    v_fields := v_quote -> 'required_fields';
  end if;

  v_errors := private.fulfillment_errors(v_fields, new.fulfillment_data);
  if cardinality(v_errors) > 0 then
    raise exception 'FULFILLMENT_INVALID: %', array_to_string(v_errors, ',') using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Live SDG total of one cart line (NULL when it cannot be ordered now).
create function private.cart_line_live_sdg(
  p_variant_id uuid,
  p_quantity integer,
  p_product_id uuid,
  p_currency text,
  p_amount numeric
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_variant_id is not null then private.live_total_sdg(p_variant_id, p_quantity)
    else (private.custom_amount_quote(p_product_id, p_currency, p_amount) ->> 'total_sdg')::numeric
  end;
$$;

-- The caller's cart as the site shows it, custom-amount lines included with
-- their live rate, fee and total (the amounts checkout will charge).
create or replace function public.my_cart()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with lines as (
    select ci.id, ci.variant_id, ci.quantity, ci.fulfillment_data, ci.created_at,
           ci.amount, ci.currency_code, pr.kind,
           coalesce(pv.required_fields, cfg.required_fields, '[]'::jsonb) as required_fields,
           coalesce(pv.max_quantity, 1) as max_quantity, pv.price_usd,
           pv.name_ar as variant_name_ar, pv.name_en as variant_name_en,
           pr.id as product_id, pr.slug as product_slug, pr.image_path,
           pr.name_ar as product_name_ar, pr.name_en as product_name_en,
           cfg.amount_decimals,
           cu.symbol as currency_symbol, cu.name_ar as currency_name_ar, cu.name_en as currency_name_en,
           (pv.is_active and pv.archived_at is null
             and pr.is_active and pr.archived_at is null
             and c.is_active and c.archived_at is null) as package_available,
           case when ci.variant_id is null
                then private.custom_amount_quote(ci.product_id, ci.currency_code, ci.amount) end as quote
      from public.cart_items ci
      left join public.product_variants pv on pv.id = ci.variant_id
      join public.products pr on pr.id = coalesce(pv.product_id, ci.product_id)
      join public.categories c on c.id = pr.category_id
      left join public.custom_amount_products cfg on cfg.product_id = ci.product_id
      left join public.currencies cu on cu.code = ci.currency_code
     where ci.user_id = (select auth.uid())
  ),
  priced as (
    select l.*,
           case when l.variant_id is not null
                then case when l.package_available and s.usd_sdg_rate is not null
                          then ceil(l.price_usd * l.quantity * s.usd_sdg_rate) end
                else (l.quote ->> 'total_sdg')::numeric end as line_total_sdg,
           case when l.variant_id is not null
                then case when l.package_available then l.price_usd * l.quantity end
                else (l.quote ->> 'total_usd')::numeric end as line_total_usd
      from lines l, public.app_settings s where s.id
  )
  select jsonb_build_object(
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'kind', p.kind, 'variant_id', p.variant_id, 'product_id', p.product_id,
        'product_slug', p.product_slug, 'image_path', p.image_path,
        'product_name_ar', p.product_name_ar, 'product_name_en', p.product_name_en,
        'variant_name_ar', p.variant_name_ar, 'variant_name_en', p.variant_name_en,
        'quantity', p.quantity, 'max_quantity', p.max_quantity,
        'fulfillment_data', p.fulfillment_data, 'required_fields', p.required_fields,
        'amount', p.amount::text, 'currency_code', p.currency_code,
        'currency_symbol', p.currency_symbol,
        'currency_name_ar', p.currency_name_ar, 'currency_name_en', p.currency_name_en,
        'amount_decimals', p.amount_decimals,
        'rate', p.quote ->> 'rate', 'fee_sdg', p.quote ->> 'fee_sdg',
        'issue', p.quote ->> 'error',
        'available', p.line_total_sdg is not null,
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

-- Checkout as before; custom-amount lines are re-priced and re-validated by
-- the same quote (rate, limits, fee read now), and a total that differs from
-- the one the page showed returns price_changed for the whole cart.
create or replace function public.checkout_cart(p_idempotency_key uuid, p_expected_total_sdg numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_order public.orders;
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
  with live as (
    select c.id, c.created_at, c.variant_id, c.quantity, c.product_id, c.currency_code, c.amount,
           c.fulfillment_data,
           private.cart_line_live_sdg(c.variant_id, c.quantity, c.product_id, c.currency_code, c.amount) as sdg
      from public.cart_items c where c.user_id = v_uid
  )
  select array_agg(l.id order by l.created_at, l.id),
         jsonb_agg(case when l.variant_id is not null
                        then jsonb_build_object('variant_id', l.variant_id, 'quantity', l.quantity,
                                                'fulfillment_data', l.fulfillment_data)
                        else jsonb_build_object('product_id', l.product_id, 'currency_code', l.currency_code,
                                                'amount', l.amount::text, 'fulfillment_data', l.fulfillment_data)
                   end order by l.created_at, l.id),
         sum(l.sdg),
         array_agg(l.id order by l.created_at, l.id) filter (where l.sdg is null)
    into v_ids, v_items, v_live, v_unavailable
    from live l;
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
          (select sum(private.cart_line_live_sdg(c.variant_id, c.quantity, c.product_id,
                                                 c.currency_code, c.amount))
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

-- 7. Invoices -----------------------------------------------------------------------
-- New invoices carry the custom-amount breakdown of such lines; package
-- lines keep exactly the shape they had. Issued invoices are not touched.
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
        'line_total_sdg', i.line_total_sdg) ||
        case when i.kind = 'custom_amount' then jsonb_build_object(
          'kind', i.kind,
          'amount', i.amount::text,
          'currency_code', i.currency_code,
          'currency_name_ar', i.currency_name_ar,
          'currency_name_en', i.currency_name_en,
          'currency_symbol', i.currency_symbol,
          'currency_rate_sdg', i.currency_rate_sdg,
          'fee_percent', i.fee_percent,
          'fee_fixed_sdg', i.fee_fixed_sdg,
          'fee_sdg', i.fee_sdg) else '{}'::jsonb end
        order by i.line_no)
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

-- 8. Listings ---------------------------------------------------------------------
-- Cards list custom-amount products too (no "from" price: the customer
-- chooses the amount), once at least one active currency is allowed. Same
-- columns as before plus `kind`.
drop function public.search_products(text, text, numeric, numeric, text, integer, integer);
create function public.search_products(
  p_query text default null,
  p_category text default null,
  p_min_sdg numeric default null,
  p_max_sdg numeric default null,
  p_sort text default 'popular',
  p_limit integer default 24,
  p_offset integer default 0
)
returns table (
  id uuid,
  slug text,
  kind text,
  category_slug text,
  category_name_ar text,
  category_name_en text,
  name_ar text,
  name_en text,
  description_ar text,
  description_en text,
  image_path text,
  is_new boolean,
  min_price_usd numeric,
  min_price_sdg numeric,
  compare_at_sdg numeric,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with settings as (
    select s.usd_sdg_rate as rate from public.app_settings s where s.id
  ),
  term as (
    select nullif(private.normalize_ar(btrim(left(coalesce(p_query, ''), 100))), '') as t
  ),
  base as (
    select p.id, p.slug, p.kind, c.slug as category_slug, c.name_ar as category_name_ar,
           c.name_en as category_name_en, p.name_ar, p.name_en,
           left(p.description_ar, 160) as description_ar, left(p.description_en, 160) as description_en,
           p.image_path, p.is_new, p.completed_orders_count, p.created_at, p.sort_order,
           min(v.price_usd) as min_price_usd,
           (array_agg(v.compare_at_price_usd order by v.price_usd, v.sort_order)
              filter (where v.id is not null))[1] as cheapest_compare_usd
      from public.products p
      join public.categories c on c.id = p.category_id
      left join public.product_variants v on v.product_id = p.id
     where (p_category is null or c.slug = p_category)
       and ((select t from term) is null
            or p.search_text like '%' || replace(replace(replace((select t from term), '\', '\\'), '%', '\%'), '_', '\_') || '%')
     group by p.id, c.id
    having (p.kind = 'package' and count(v.id) > 0)
        or (p.kind = 'custom_amount' and exists (
              select 1 from public.custom_amount_currencies cc
                join public.currencies cu on cu.code = cc.currency_code
               where cc.product_id = p.id and cu.is_active))
  ),
  priced as (
    select b.*, ceil(b.min_price_usd * (select rate from settings)) as min_price_sdg,
           case when b.cheapest_compare_usd > b.min_price_usd
                then ceil(b.cheapest_compare_usd * (select rate from settings)) end as compare_at_sdg
      from base b
  )
  select pr.id, pr.slug, pr.kind, pr.category_slug, pr.category_name_ar, pr.category_name_en,
         pr.name_ar, pr.name_en, pr.description_ar, pr.description_en, pr.image_path, pr.is_new,
         pr.min_price_usd, pr.min_price_sdg, pr.compare_at_sdg,
         count(*) over () as total_count
    from priced pr
   where (p_min_sdg is null or pr.min_price_sdg >= p_min_sdg)
     and (p_max_sdg is null or pr.min_price_sdg <= p_max_sdg)
   order by
     case when p_sort = 'price_asc' then pr.min_price_usd end asc nulls last,
     case when p_sort = 'price_desc' then pr.min_price_usd end desc nulls last,
     case when p_sort = 'newest' then pr.created_at end desc nulls last,
     pr.completed_orders_count desc, pr.sort_order, pr.slug
   limit least(greatest(coalesce(p_limit, 24), 1), 48)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- 9. Grants -----------------------------------------------------------------------
revoke execute on function private.currencies_before_write() from public, anon, authenticated;
revoke execute on function private.app_settings_sync_usd() from public, anon, authenticated;
revoke execute on function private.products_kind_immutable() from public, anon, authenticated;
revoke execute on function private.product_variants_kind_check() from public, anon, authenticated;
revoke execute on function private.custom_amount_products_before_write() from public, anon, authenticated;
revoke execute on function private.products_create_custom_settings() from public, anon, authenticated;
revoke execute on function private.custom_amount_currencies_before_update() from public, anon, authenticated;
revoke execute on function private.custom_amount_quote(uuid, text, numeric, numeric) from public, anon, authenticated;
revoke execute on function private.cart_line_live_sdg(uuid, integer, uuid, text, numeric) from public, anon, authenticated;
revoke execute on function public.search_products(text, text, numeric, numeric, text, integer, integer) from public;
grant execute on function public.search_products(text, text, numeric, numeric, text, integer, integer) to anon, authenticated;
