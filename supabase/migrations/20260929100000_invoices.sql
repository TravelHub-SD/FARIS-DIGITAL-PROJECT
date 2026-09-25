-- Phase 8: invoices.
--
-- * Issued automatically, in the same transaction, when an order becomes
--   `completed`. Numbering stays the Phase 1 counter row (gapless per
--   Khartoum year): the row lock serialises concurrent completions, and a
--   completion that rolls back takes its number back with it.
-- * The snapshot is everything the invoice shows, copied at issue time:
--   seller (name, contacts, address), customer (name, phone), order lines and
--   money, and the accepted payment. Later price, rate, profile or settings
--   changes never reach an issued invoice (immutable since Phase 1).
-- * Corrections: `invoices` staff void an invoice with a reason and issue a
--   new one (new number, snapshot taken again). Both audited.
-- * History and search go through search_invoices(), SECURITY INVOKER, so the
--   same RLS applies as to the table: customers get their own issued
--   invoices, `invoices` staff get all.

-- 1. Seller name belongs to the invoice (the product name is temporary) ------
alter table public.app_settings
  add column business_name_ar text not null default 'فارس ديجيتال'
    check (char_length(business_name_ar) between 1 and 120),
  add column business_name_en text not null default 'Faris Digital'
    check (char_length(business_name_en) between 1 and 120);
grant update (business_name_ar, business_name_en) on public.app_settings to authenticated;

-- 2. Snapshot: seller name and the accepted payment instead of the list of
--    bank accounts (an issued invoice is for a paid order).
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

  -- Gapless: the counter row is updated inside this transaction, so a failed
  -- insert rolls the number back (a sequence would leave a gap), and
  -- concurrent issuers wait for each other on the row lock.
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

-- 3. Issue on completion ---------------------------------------------------------
create function private.issue_invoice_on_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    insert into public.invoices (order_id) values (new.id)
    on conflict (order_id) where status = 'issued' do nothing;
  end if;
  return null;
end;
$$;

create trigger orders_issue_invoice
  after update of status on public.orders
  for each row execute function private.issue_invoice_on_completion();

-- Orders completed before this migration (local/test data only) get theirs now.
insert into public.invoices (order_id)
select o.id from public.orders o
 where o.status = 'completed'
   and not exists (select 1 from public.invoices i where i.order_id = o.id and i.status = 'issued')
 order by o.completed_at, o.id;

-- 4. Void and re-issue (invoices permission) ---------------------------------
create function public.void_invoice(p_invoice_id uuid, p_reason text)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(p_reason), '');
  v_row public.invoices;
begin
  if not private.has_permission('invoices') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'VOID_REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'NOTE_TOO_LONG' using errcode = 'P0001';
  end if;
  update public.invoices set status = 'void', void_reason = v_reason
   where id = p_invoice_id and status = 'issued'
  returning * into v_row;
  if not found then
    raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

-- A new invoice (new number, snapshot taken again) for a completed order
-- whose invoice was voided, e.g. after correcting the customer's name.
create function public.reissue_invoice(p_order_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.invoices;
begin
  if not private.has_permission('invoices') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if exists (select 1 from public.invoices where order_id = p_order_id and status = 'issued') then
    raise exception 'INVOICE_ALREADY_ISSUED' using errcode = 'P0001';
  end if;
  insert into public.invoices (order_id) values (p_order_id) returning * into v_row;
  return v_row;
end;
$$;

-- 5. History and search (RLS applies: SECURITY INVOKER) ------------------------
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
         i.snapshot #>> '{order,product_name_ar}', i.snapshot #>> '{order,product_name_en}',
         i.total_sdg, count(*) over ()
    from public.invoices i, q
   where (q.text is null
          or i.invoice_number ilike '%' || q.text || '%'
          or (i.snapshot #>> '{order,reference}') ilike '%' || q.text || '%'
          or private.normalize_ar(i.snapshot #>> '{customer,full_name}') like '%' || private.normalize_ar(q.text) || '%'
          -- Phone in local (09…) or international (+2499…) form.
          or (char_length(q.digits) >= 6
              and (i.snapshot #>> '{customer,phone}') like '%' || right(q.digits, 9) || '%'))
     and (p_status is null or i.status = p_status)
     -- "My invoices": only the caller's own issued invoices, even for staff
     -- whose permission lets RLS show them everyone's.
     and (not p_mine or (i.status = 'issued' and exists (
           select 1 from public.orders o where o.id = i.order_id and o.user_id = (select auth.uid()))))
     and (p_from is null or i.issued_at >= (p_from::timestamp at time zone 'Africa/Khartoum'))
     and (p_to is null or i.issued_at < ((p_to + 1)::timestamp at time zone 'Africa/Khartoum'))
   order by i.issued_at desc, i.invoice_number desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- 6. Grants ---------------------------------------------------------------------
revoke execute on function private.issue_invoice_on_completion() from public, anon, authenticated;
revoke execute on function public.void_invoice(uuid, text) from public, anon;
revoke execute on function public.reissue_invoice(uuid) from public, anon;
revoke execute on function public.search_invoices(text, public.invoice_status, date, date, integer, integer, boolean) from public, anon;
grant execute on function public.void_invoice(uuid, text) to authenticated;
grant execute on function public.reissue_invoice(uuid) to authenticated;
grant execute on function public.search_invoices(text, public.invoice_status, date, date, integer, integer, boolean) to authenticated;
