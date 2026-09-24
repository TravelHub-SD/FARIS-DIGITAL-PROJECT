-- Phase 5: order creation, payment receipts, receipt review.
--   * create_order() is the only way a customer creates an order. The price is
--     computed here and again by the orders BEFORE INSERT trigger; the browser
--     sends only what it believes the total is, as consent, never as input.
--   * submit_receipt() registers a receipt the server already uploaded. The
--     file hash comes from the storage object's metadata (written by the
--     server with the service role), not from a parameter the caller controls.
--   * review_receipt() accepts/rejects; accepting moves the order to
--     processing through the normal transition rules.
-- All three run with the caller's JWT, so auth.uid() and the audit log name
-- the real actor.

-- Live SDG total for a visible variant, same formula as the order trigger.
-- NULL when the variant is not orderable or pricing is not configured.
create function private.live_total_sdg(p_variant_id uuid, p_quantity integer)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select ceil(pv.price_usd * p_quantity * s.usd_sdg_rate)
    from public.product_variants pv
    join public.products pr on pr.id = pv.product_id
    join public.categories c on c.id = pr.category_id
    cross join public.app_settings s
   where pv.id = p_variant_id and s.id
     and pv.is_active and pv.archived_at is null
     and pr.is_active and pr.archived_at is null
     and c.is_active and c.archived_at is null;
$$;

-- SDG totals for quantities 1..max_quantity (PostgREST computed field:
-- select=...,price_sdg_totals). The product page renders these and the
-- order form sends the chosen one back as the price the customer agreed to.
-- Computed here so the page never re-implements the formula: per-unit price
-- times quantity would differ from the charged total by the rounding.
create function public.price_sdg_totals(v public.product_variants)
returns numeric[]
language sql
stable
security invoker
set search_path = ''
as $$
  select array_agg(ceil(v.price_usd * q * s.usd_sdg_rate) order by q)
    from public.app_settings s, generate_series(1, v.max_quantity) q
   where s.id and s.usd_sdg_rate is not null;
$$;

create function public.create_order(
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
  if (select count(*) from public.orders
       where user_id = v_uid and created_at > now() - interval '1 hour') >= 10 then
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

-- Duplicate receipt image: the same file cannot back two live receipts
-- (decisions.md 2026-09-26: blocked, no longer only flagged).
drop index public.payment_receipts_sha256;
create unique index payment_receipts_sha256_unique
  on public.payment_receipts (file_sha256)
  where status <> 'rejected';

create function public.submit_receipt(
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
  if (select count(*) from public.payment_receipts r where r.order_id = p_order_id) >= 5 then
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

-- Orders staff: accept or reject a pending receipt. Accepting moves the order
-- to processing (the transition trigger requires the accepted receipt).
create function public.review_receipt(p_receipt_id uuid, p_accept boolean, p_reason text default null)
returns public.payment_receipts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.payment_receipts;
  v_order_status text;
begin
  if not private.has_permission('orders') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_accept is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;
  select * into v_row from public.payment_receipts where id = p_receipt_id for update;
  if not found then
    raise exception 'RECEIPT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.user_id = v_uid then
    raise exception 'RECEIPT_CANNOT_REVIEW_OWN' using errcode = '42501';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'RECEIPT_NOT_PENDING' using errcode = 'P0001';
  end if;
  if not p_accept and coalesce(btrim(p_reason), '') = '' then
    raise exception 'RECEIPT_REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if p_reason is not null and char_length(btrim(p_reason)) > 500 then
    raise exception 'NOTE_TOO_LONG' using errcode = 'P0001';
  end if;

  select o.status into v_order_status from public.orders o where o.id = v_row.order_id for update;
  if p_accept and v_order_status <> 'new' then
    raise exception 'ORDER_NOT_AWAITING_PAYMENT' using errcode = 'P0001';
  end if;

  update public.payment_receipts
     set status = case when p_accept then 'accepted'::public.review_status else 'rejected'::public.review_status end,
         rejection_reason = case when p_accept then null else btrim(p_reason) end,
         reviewed_by = v_uid,
         reviewed_at = now()
   where id = p_receipt_id
  returning * into v_row;

  if p_accept then
    update public.orders set status = 'processing' where id = v_row.order_id;
  end if;
  return v_row;
end;
$$;

-- Order creation is now audited too (actor = the customer). Fulfillment data
-- stays out of the log: it can hold account emails and similar.
drop trigger audit_orders on public.orders;
create trigger audit_orders
  after insert or update or delete on public.orders
  for each row execute function private.audit_row('fulfillment_data', 'fulfillment_fields');

-- Receipt submissions are audited as well (reviews already were).
drop trigger audit_payment_receipts on public.payment_receipts;
create trigger audit_payment_receipts
  after insert or update or delete on public.payment_receipts
  for each row execute function private.audit_row();

-- Sensitive fulfillment fields (definitions with "sensitive": true) are
-- removed from the order once it reaches a terminal status. Same rules as
-- before, plus the purge.
create or replace function private.orders_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  c_mutable constant text[] := array[
    'status', 'updated_at', 'completed_at', 'cancelled_at', 'fulfillment_data'
  ];
  v_sensitive text[];
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

    if exists (select 1 from public.order_statuses s where s.code = new.status and s.is_terminal) then
      select coalesce(array_agg(f ->> 'key'), '{}') into v_sensitive
        from jsonb_array_elements(old.fulfillment_fields) f
       where (f ->> 'sensitive')::boolean is true;
      new.fulfillment_data := new.fulfillment_data - v_sensitive;
    end if;
  else
    new.completed_at := old.completed_at;
    new.cancelled_at := old.cancelled_at;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function private.live_total_sdg(uuid, integer) from public, anon, authenticated;
revoke execute on function public.price_sdg_totals(public.product_variants) from public;
grant execute on function public.price_sdg_totals(public.product_variants) to anon, authenticated;
revoke execute on function public.create_order(uuid, integer, jsonb, uuid, numeric) from public, anon;
revoke execute on function public.submit_receipt(uuid, uuid, text, text) from public, anon;
revoke execute on function public.review_receipt(uuid, boolean, text) from public, anon;
grant execute on function public.create_order(uuid, integer, jsonb, uuid, numeric) to authenticated;
grant execute on function public.submit_receipt(uuid, uuid, text, text) to authenticated;
grant execute on function public.review_receipt(uuid, boolean, text) to authenticated;
