-- Phase 4: public catalog.
--   * Fulfillment field definitions are validated by a CHECK constraint.
--   * Order fulfillment data is validated against those definitions inside
--     the order trigger (every insert path, not just the app).
--   * search_products() and price_sdg() are SECURITY INVOKER: RLS decides
--     what the caller sees, so hidden/inactive rows can never be returned.

-- Field definition shape (mirrors src/lib/fulfillment.ts):
--   { key, type: text|digits|phone|email|select, label_ar?, label_en?,
--     required: bool, min_length?, max_length? (text/digits, 1..200),
--     options?: [{ value, label_ar?, label_en? }] (select only),
--     sensitive?: bool }
-- No admin-supplied regex type: a pattern typed in the dashboard would run
-- against user input on the server (ReDoS). "digits" covers player IDs.
create function private.valid_field_definitions(p_defs jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_field jsonb;
  v_option jsonb;
  v_keys text[] := '{}';
  v_values text[];
  v_key text;
  v_type text;
  v_min numeric;
  v_max numeric;
begin
  if p_defs is null or jsonb_typeof(p_defs) <> 'array' or jsonb_array_length(p_defs) > 10 then
    return false;
  end if;
  for v_field in select * from jsonb_array_elements(p_defs) loop
    if jsonb_typeof(v_field) <> 'object' then
      return false;
    end if;
    if exists (select 1 from jsonb_object_keys(v_field) as k
                where k not in ('key', 'type', 'label_ar', 'label_en', 'required',
                                'min_length', 'max_length', 'options', 'sensitive')) then
      return false;
    end if;

    v_key := v_field ->> 'key';
    if jsonb_typeof(v_field -> 'key') is distinct from 'string'
       or v_key !~ '^[a-z][a-z0-9_]{0,39}$' or v_key = any (v_keys) then
      return false;
    end if;
    v_keys := v_keys || v_key;

    v_type := v_field ->> 'type';
    if v_type is null or v_type not in ('text', 'digits', 'phone', 'email', 'select') then
      return false;
    end if;
    if jsonb_typeof(v_field -> 'required') is distinct from 'boolean' then
      return false;
    end if;
    if v_field ? 'sensitive' and jsonb_typeof(v_field -> 'sensitive') <> 'boolean' then
      return false;
    end if;
    if (v_field ? 'label_ar' and (jsonb_typeof(v_field -> 'label_ar') <> 'string' or char_length(v_field ->> 'label_ar') not between 1 and 80))
       or (v_field ? 'label_en' and (jsonb_typeof(v_field -> 'label_en') <> 'string' or char_length(v_field ->> 'label_en') not between 1 and 80))
       or coalesce(v_field ->> 'label_ar', v_field ->> 'label_en') is null then
      return false;
    end if;

    if v_field ? 'min_length' or v_field ? 'max_length' then
      if v_type not in ('text', 'digits') then
        return false;
      end if;
      if (v_field ? 'min_length' and jsonb_typeof(v_field -> 'min_length') <> 'number')
         or (v_field ? 'max_length' and jsonb_typeof(v_field -> 'max_length') <> 'number') then
        return false;
      end if;
      v_min := coalesce((v_field ->> 'min_length')::numeric, 1);
      v_max := coalesce((v_field ->> 'max_length')::numeric, 100);
      if v_min <> trunc(v_min) or v_max <> trunc(v_max) or v_min < 1 or v_max > 200 or v_min > v_max then
        return false;
      end if;
    end if;

    if v_type = 'select' then
      if jsonb_typeof(v_field -> 'options') is distinct from 'array'
         or jsonb_array_length(v_field -> 'options') not between 1 and 50 then
        return false;
      end if;
      v_values := '{}';
      for v_option in select * from jsonb_array_elements(v_field -> 'options') loop
        if jsonb_typeof(v_option) <> 'object'
           or exists (select 1 from jsonb_object_keys(v_option) as k where k not in ('value', 'label_ar', 'label_en'))
           or jsonb_typeof(v_option -> 'value') is distinct from 'string'
           or (v_option ->> 'value') !~ '^[A-Za-z0-9_-]{1,40}$'
           or (v_option ->> 'value') = any (v_values)
           or coalesce(v_option ->> 'label_ar', v_option ->> 'label_en') is null
           or char_length(coalesce(v_option ->> 'label_ar', '')) > 80
           or char_length(coalesce(v_option ->> 'label_en', '')) > 80 then
          return false;
        end if;
        v_values := v_values || (v_option ->> 'value');
      end loop;
    elsif v_field ? 'options' then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

-- Validates submitted fulfillment data (already normalised by the server:
-- trimmed strings, phones in E.164, digits in ASCII). Returns error codes,
-- empty when valid: missing:<key>, unknown:<key>, type:<key>,
-- length:<key>, format:<key>, option:<key>, data:not_object.
create function private.fulfillment_errors(p_defs jsonb, p_data jsonb)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_errors text[] := '{}';
  v_field jsonb;
  v_key text;
  v_type text;
  v_value jsonb;
  v_text text;
  v_min integer;
  v_max integer;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    return array['data:not_object'];
  end if;

  select coalesce(array_agg('unknown:' || k order by k), '{}') into v_errors
    from jsonb_object_keys(p_data) as k
   where not exists (select 1 from jsonb_array_elements(p_defs) d where d ->> 'key' = k);

  for v_field in select * from jsonb_array_elements(p_defs) loop
    v_key := v_field ->> 'key';
    v_type := v_field ->> 'type';
    v_value := p_data -> v_key;

    if v_value is null or jsonb_typeof(v_value) = 'null' then
      if (v_field ->> 'required')::boolean then
        v_errors := v_errors || ('missing:' || v_key);
      end if;
      continue;
    end if;
    if jsonb_typeof(v_value) <> 'string' then
      v_errors := v_errors || ('type:' || v_key);
      continue;
    end if;

    v_text := v_value #>> '{}';
    v_min := coalesce((v_field ->> 'min_length')::integer, 1);
    v_max := coalesce((v_field ->> 'max_length')::integer, case v_type when 'email' then 254 else 100 end);

    if v_text = '' or v_text <> btrim(v_text) or v_text ~ '[[:cntrl:]]' then
      v_errors := v_errors || ('format:' || v_key);
    elsif char_length(v_text) < v_min or char_length(v_text) > v_max then
      v_errors := v_errors || ('length:' || v_key);
    elsif v_type = 'digits' and v_text !~ '^[0-9]+$' then
      v_errors := v_errors || ('format:' || v_key);
    elsif v_type = 'phone' and v_text !~ '^\+249[19][0-9]{8}$' then
      v_errors := v_errors || ('format:' || v_key);
    elsif v_type = 'email' and v_text !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      v_errors := v_errors || ('format:' || v_key);
    elsif v_type = 'select' and not exists (
      select 1 from jsonb_array_elements(v_field -> 'options') o where o ->> 'value' = v_text
    ) then
      v_errors := v_errors || ('option:' || v_key);
    end if;
  end loop;
  return v_errors;
end;
$$;

alter table public.product_variants
  add constraint product_variants_required_fields_valid
  check (private.valid_field_definitions(required_fields));

create or replace function private.orders_before_insert()
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
  v_errors text[];
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

  -- Fulfillment data must match the variant's declared fields exactly:
  -- no missing required keys, no unknown keys, strings only, lengths,
  -- formats and select options (Phase 4).
  v_errors := private.fulfillment_errors(v_variant.required_fields, coalesce(new.fulfillment_data, '{}'::jsonb));
  if cardinality(v_errors) > 0 then
    raise exception 'FULFILLMENT_INVALID: %', array_to_string(v_errors, ',') using errcode = 'P0001';
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

-- SDG price of a variant at the current rate. PostgREST computed field:
-- select=...,price_sdg. Same formula as the order trigger (ceil to whole SDG).
-- NULL while the owner has not set a rate.
create function public.price_sdg(v public.product_variants)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select ceil(v.price_usd * s.usd_sdg_rate) from public.app_settings s where s.id;
$$;

-- Catalog listing/search. SECURITY INVOKER: products, categories and variants
-- are read through the caller's RLS, so hidden, inactive and archived rows
-- (and products without a visible variant) never appear.
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
  category_slug text,
  category_name_ar text,
  category_name_en text,
  name_ar text,
  name_en text,
  image_path text,
  min_price_usd numeric,
  min_price_sdg numeric,
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
    select p.id, p.slug, c.slug as category_slug, c.name_ar as category_name_ar,
           c.name_en as category_name_en, p.name_ar, p.name_en, p.image_path,
           p.completed_orders_count, p.created_at, p.sort_order,
           min(v.price_usd) as min_price_usd
      from public.products p
      join public.categories c on c.id = p.category_id
      join public.product_variants v on v.product_id = p.id
     where (p_category is null or c.slug = p_category)
       and ((select t from term) is null
            or p.search_text like '%' || replace(replace(replace((select t from term), '\', '\\'), '%', '\%'), '_', '\_') || '%')
     group by p.id, c.id
  ),
  priced as (
    select b.*, ceil(b.min_price_usd * (select rate from settings)) as min_price_sdg from base b
  )
  select pr.id, pr.slug, pr.category_slug, pr.category_name_ar, pr.category_name_en,
         pr.name_ar, pr.name_en, pr.image_path, pr.min_price_usd, pr.min_price_sdg,
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

revoke execute on function private.valid_field_definitions(jsonb) from public, anon, authenticated;
revoke execute on function private.fulfillment_errors(jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.price_sdg(public.product_variants) from public;
revoke execute on function public.search_products(text, text, numeric, numeric, text, integer, integer) from public;
grant execute on function public.price_sdg(public.product_variants) to anon, authenticated;
grant execute on function public.search_products(text, text, numeric, numeric, text, integer, integer) to anon, authenticated;
