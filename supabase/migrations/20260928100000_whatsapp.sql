-- Phase 7: WhatsApp delivery (Meta Cloud API).
--
-- message_logs becomes an OUTBOX that never holds message content:
--   * business events (an order status recorded, a KYC decision) insert a
--     `queued` row in the same transaction, with REFERENCES only (order,
--     status-history row, KYC submission). No network call inside any
--     business transaction, so a Meta outage cannot break an order.
--   * the server renders the template parameters at send time from those
--     references; the text (reference, status, notes, reasons) is never
--     stored here. OTP rows reference nothing: the code exists only in memory.
--   * errors are stored as short codes (`meta:131026`, `network:timeout`),
--     never as provider error text (which can echo parameter values).
--   * retries are bounded (max_attempts, backoff 1 / 5 / 30 min); a
--     notification that still fails is flagged `needs_attention` for staff.
--   * delivery webhooks are recorded once per (message, status): replaying a
--     captured webhook changes nothing.
--   * cost per message: category from the template (estimate at send) and
--     from Meta's pricing object in the webhook; USD rate from
--     whatsapp_rates (set by the owner from Meta's rate card).

-- 1. message_logs without content ---------------------------------------------
alter table public.message_logs drop constraint message_logs_no_otp_payload;
alter table public.message_logs drop column payload;
alter table public.message_logs drop column error_message;
alter table public.message_logs drop column estimated_cost_usd;

alter table public.message_logs
  add column language text not null default 'ar' check (language in ('ar', 'en')),
  add column status_history_id bigint references public.order_status_history (id) on delete set null,
  add column kyc_submission_id uuid references public.kyc_submissions (id) on delete set null,
  add column max_attempts smallint not null default 4 check (max_attempts between 1 and 10),
  add column locked_until timestamptz,
  add column sent_at timestamptz,
  add column delivered_at timestamptz,
  add column read_at timestamptz,
  add column failed_at timestamptz,
  add column needs_attention boolean not null default false,
  add column handled_by uuid references public.profiles (id),
  add column handled_at timestamptz,
  add column pricing_category text check (pricing_category in ('authentication', 'utility', 'marketing', 'service')),
  add column billable boolean,
  add column cost_usd numeric(10, 5) check (cost_usd >= 0),
  add column cost_source text check (cost_source in ('estimate', 'webhook'));

-- NOT VALID: enforced for every new or updated row; rows written before this
-- phase (which could not be rendered again anyway) are left as they are.
alter table public.message_logs
  add constraint message_logs_error_code_format
    check (error_code is null or error_code ~ '^[a-z]+:[a-z0-9_.-]{1,40}$') not valid;
alter table public.message_logs
  add constraint message_logs_template_name_format
    check (template_name ~ '^[a-z0-9_]{1,64}$') not valid;
alter table public.message_logs
  add constraint message_logs_references check (
    case message_type
      when 'otp' then order_id is null and status_history_id is null and kyc_submission_id is null
      when 'order_status' then order_id is not null and status_history_id is not null
      when 'kyc_result' then kyc_submission_id is not null
    end
  ) not valid;

create index message_logs_due on public.message_logs (next_retry_at)
  where status = 'queued';
create index message_logs_attention on public.message_logs (created_at desc)
  where needs_attention;

-- Delivery events from the webhook, one row per (message, status).
create table private.message_events (
  id bigint generated always as identity primary key,
  provider_message_id text not null,
  status text not null check (status in ('sent', 'delivered', 'read', 'failed')),
  occurred_at timestamptz not null,
  error_code text check (error_code is null or error_code ~ '^[a-z]+:[a-z0-9_.-]{1,40}$'),
  pricing_category text,
  billable boolean,
  received_at timestamptz not null default now(),
  unique (provider_message_id, status)
);
alter table private.message_events enable row level security;

-- 2. Rates (owner/settings staff enter them from Meta's rate card) -----------
create table public.whatsapp_rates (
  category text primary key check (category in ('authentication', 'utility', 'marketing', 'service')),
  usd_per_message numeric(10, 5) check (usd_per_message >= 0),
  updated_at timestamptz not null default now()
);
-- No invented prices: NULL until someone copies them from Meta's rate card
-- for Sudan's market. Costs recorded while a rate is NULL stay NULL and show
-- as "unpriced" in the dashboard.
insert into public.whatsapp_rates (category) values
  ('authentication'), ('utility'), ('marketing'), ('service');

create trigger whatsapp_rates_set_updated_at
  before update on public.whatsapp_rates
  for each row execute function private.set_updated_at();

alter table public.whatsapp_rates enable row level security;
grant select, update (usd_per_message) on public.whatsapp_rates to authenticated;
create policy whatsapp_rates_select on public.whatsapp_rates
  for select to authenticated
  using ((select private.has_permission('settings')) or (select private.has_permission('orders')));
create policy whatsapp_rates_update on public.whatsapp_rates
  for update to authenticated
  using ((select private.has_permission('settings')))
  with check ((select private.has_permission('settings')));

create trigger audit_whatsapp_rates
  after update on public.whatsapp_rates
  for each row execute function private.audit_row();

-- 3. Enqueue: order status notifications and KYC results ---------------------
create function private.enqueue_order_status_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer record;
begin
  if not exists (select 1 from public.order_statuses s
                  where s.code = new.to_status and s.notify_customer) then
    return null;
  end if;
  select p.id, p.phone_e164, p.locale into v_customer
    from public.orders o join public.profiles p on p.id = o.user_id
   where o.id = new.order_id and p.phone_verified_at is not null;
  if not found then
    return null;
  end if;
  insert into public.message_logs
    (phone_e164, user_id, message_type, template_name, order_id, status_history_id, language, next_retry_at)
  values
    (v_customer.phone_e164, v_customer.id, 'order_status', 'order_status_update',
     new.order_id, new.id, v_customer.locale, now());
  return null;
end;
$$;

create trigger order_status_history_enqueue_message
  after insert on public.order_status_history
  for each row execute function private.enqueue_order_status_message();

create function private.enqueue_kyc_result_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer record;
begin
  if old.status <> 'pending' or new.status = 'pending' then
    return null;
  end if;
  select p.id, p.phone_e164, p.locale into v_customer
    from public.profiles p where p.id = new.user_id and p.phone_e164 is not null;
  if not found then
    return null;
  end if;
  insert into public.message_logs
    (phone_e164, user_id, message_type, template_name, kyc_submission_id, language, next_retry_at)
  values
    (v_customer.phone_e164, v_customer.id, 'kyc_result',
     case when new.status = 'accepted' then 'kyc_approved' else 'kyc_rejected' end,
     new.id, v_customer.locale, now());
  return null;
end;
$$;

create trigger kyc_submissions_enqueue_message
  after update of status on public.kyc_submissions
  for each row execute function private.enqueue_kyc_result_message();

-- 4. Dispatcher RPCs (service role only) ---------------------------------------

-- Claims due notifications. SKIP LOCKED + a lease: the after-response
-- dispatch and the scheduled tick never send the same row twice at once.
create function public.whatsapp_claim(p_limit integer default 20, p_lease_seconds integer default 120)
returns setof public.message_logs
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A send that died mid-attempt (process killed, lease expired) on its last
  -- attempt is not left queued forever: it becomes a visible failure.
  update public.message_logs
     set status = 'failed', error_code = 'app:interrupted', failed_at = now(),
         locked_until = null, next_retry_at = null, needs_attention = true
   where status = 'queued' and message_type <> 'otp'
     and attempts >= max_attempts and locked_until < now();

  return query
  update public.message_logs m
     set locked_until = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
         attempts = m.attempts + 1
   where m.id in (
     select c.id from public.message_logs c
      where c.status = 'queued'
        and c.message_type <> 'otp'
        and c.next_retry_at <= now()
        and (c.locked_until is null or c.locked_until < now())
        and c.attempts < c.max_attempts
      order by c.next_retry_at
      limit least(greatest(coalesce(p_limit, 20), 1), 100)
      for update skip locked)
  returning m.*;
end;
$$;

-- Everything needed to render a notification, read from the source records.
create function public.whatsapp_message_context(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', m.id,
    'type', m.message_type,
    'template', m.template_name,
    'language', m.language,
    'to', m.phone_e164,
    'reference', o.reference,
    'status_ar', s.name_ar,
    'status_en', s.name_en,
    'customer_note', h.customer_note,
    'kyc_reason', k.rejection_reason)
    from public.message_logs m
    left join public.orders o on o.id = m.order_id
    left join public.order_status_history h on h.id = m.status_history_id
    left join public.order_statuses s on s.code = h.to_status
    left join public.kyc_submissions k on k.id = m.kyc_submission_id
   where m.id = p_id;
$$;

create function private.rate_for(p_category text)
returns numeric
language sql
stable
set search_path = ''
as $$
  select r.usd_per_message from public.whatsapp_rates r where r.category = p_category;
$$;

create function public.whatsapp_mark_sent(p_id uuid, p_provider_message_id text, p_category text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.message_logs
     set status = 'sent',
         provider_message_id = p_provider_message_id,
         sent_at = now(),
         locked_until = null,
         next_retry_at = null,
         error_code = null,
         pricing_category = p_category,
         -- Estimate until Meta's webhook confirms billing for this message.
         cost_usd = case when cost_source = 'webhook' then cost_usd else private.rate_for(p_category) end,
         cost_source = coalesce(cost_source, 'estimate')
   where id = p_id;
end;
$$;

-- Bounded retry: attempts 1..max_attempts, waiting 1, 5 then 30 minutes.
-- A notification that fails for good is flagged for staff; an OTP is not
-- retried (the code would be stale) and is not flagged individually.
create function public.whatsapp_mark_failure(p_id uuid, p_error_code text, p_retryable boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.message_logs;
begin
  select * into v_row from public.message_logs where id = p_id for update;
  if not found then
    return 'unknown';
  end if;
  if p_retryable and v_row.message_type <> 'otp' and v_row.attempts < v_row.max_attempts then
    update public.message_logs
       set status = 'queued',
           error_code = p_error_code,
           locked_until = null,
           next_retry_at = now() + case v_row.attempts
             when 1 then interval '1 minute'
             when 2 then interval '5 minutes'
             else interval '30 minutes' end
     where id = p_id;
    return 'retry';
  end if;
  update public.message_logs
     set status = 'failed',
         error_code = p_error_code,
         failed_at = now(),
         locked_until = null,
         next_retry_at = null,
         needs_attention = message_type <> 'otp'
   where id = p_id;
  return 'failed';
end;
$$;

-- OTP: logged at send time (no references, no code), never retried.
create function public.whatsapp_log_otp(p_phone text, p_user_id uuid, p_language text)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.message_logs (phone_e164, user_id, message_type, template_name, language, attempts, max_attempts)
  values (p_phone, p_user_id, 'otp', 'otp_code', case when p_language = 'en' then 'en' else 'ar' end, 1, 1)
  returning id;
$$;

-- Webhook status. Returns applied | duplicate | unknown_message.
create function public.whatsapp_apply_status(
  p_provider_message_id text,
  p_status text,
  p_occurred_at timestamptz,
  p_error_code text default null,
  p_pricing_category text default null,
  p_billable boolean default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event bigint;
  v_row public.message_logs;
  v_rank_new integer := case p_status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 0 end;
  v_rank_old integer;
begin
  if p_status not in ('sent', 'delivered', 'read', 'failed') then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;
  select * into v_row from public.message_logs where provider_message_id = p_provider_message_id for update;
  if not found then
    return 'unknown_message';
  end if;

  insert into private.message_events (provider_message_id, status, occurred_at, error_code, pricing_category, billable)
  values (p_provider_message_id, p_status, p_occurred_at, p_error_code,
          case when p_pricing_category in ('authentication', 'utility', 'marketing', 'service') then p_pricing_category end,
          p_billable)
  on conflict (provider_message_id, status) do nothing
  returning id into v_event;
  if v_event is null then
    return 'duplicate';
  end if;

  -- Billing: the first event carrying Meta's pricing fixes the cost.
  if p_billable is not null and v_row.cost_source is distinct from 'webhook' then
    update public.message_logs
       set billable = p_billable,
           pricing_category = coalesce(case when p_pricing_category in ('authentication', 'utility', 'marketing', 'service') then p_pricing_category end, pricing_category),
           cost_usd = case when p_billable
                           then private.rate_for(coalesce(case when p_pricing_category in ('authentication', 'utility', 'marketing', 'service') then p_pricing_category end, pricing_category))
                           else 0 end,
           cost_source = 'webhook'
     where id = v_row.id;
  end if;

  if p_status = 'failed' then
    update public.message_logs
       set status = 'failed',
           failed_at = coalesce(failed_at, p_occurred_at),
           error_code = coalesce(p_error_code, error_code),
           needs_attention = message_type <> 'otp'
     where id = v_row.id and status <> 'failed';
    return 'applied';
  end if;

  v_rank_old := case v_row.status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 0 end;
  update public.message_logs
     set status = case when v_rank_new > v_rank_old and v_row.status <> 'failed'
                       then p_status::public.message_status else status end,
         delivered_at = case when p_status in ('delivered', 'read') then coalesce(delivered_at, p_occurred_at) else delivered_at end,
         read_at = case when p_status = 'read' then coalesce(read_at, p_occurred_at) else read_at end
   where id = v_row.id;
  return 'applied';
end;
$$;

-- 5. Staff actions on failed notifications (orders permission) ---------------
create function public.whatsapp_mark_handled(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('orders') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update public.message_logs
     set needs_attention = false, handled_by = (select auth.uid()), handled_at = now()
   where id = p_id and needs_attention;
  if not found then
    raise exception 'MESSAGE_NOT_FOUND' using errcode = 'P0002';
  end if;
  insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, new_data)
  values ((select auth.uid()), 'authenticated', 'message_logs.handled', 'message_logs', p_id::text, null);
end;
$$;

-- One more attempt for a failed notification (e.g. after Meta recovered).
create function public.whatsapp_retry(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('orders') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update public.message_logs
     set status = 'queued', needs_attention = false, next_retry_at = now(),
         locked_until = null, failed_at = null,
         max_attempts = least(attempts + 1, 10)
   where id = p_id and status = 'failed' and message_type <> 'otp';
  if not found then
    raise exception 'MESSAGE_NOT_RETRYABLE' using errcode = 'P0001';
  end if;
  insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, new_data)
  values ((select auth.uid()), 'authenticated', 'message_logs.retry', 'message_logs', p_id::text, null);
end;
$$;

-- Spend for the owner / settings staff: counts and cost by type and category.
create function public.whatsapp_spend(p_from date, p_to date)
returns table (
  message_type public.message_type,
  pricing_category text,
  messages bigint,
  delivered bigint,
  failed bigint,
  priced bigint,
  cost_usd numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('settings') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return query
  select m.message_type, m.pricing_category,
         count(*),
         count(*) filter (where m.status in ('delivered', 'read')),
         count(*) filter (where m.status = 'failed'),
         count(*) filter (where m.cost_usd is not null),
         coalesce(sum(m.cost_usd), 0)
    from public.message_logs m
   where m.created_at >= (p_from::timestamp at time zone 'Africa/Khartoum')
     and m.created_at < ((p_to + 1)::timestamp at time zone 'Africa/Khartoum')
     and m.status <> 'queued'
   group by 1, 2
   order by 1, 2;
end;
$$;

-- 6. Scheduled retries: pg_cron → pg_net → the app's dispatch endpoint --------
-- The URL and bearer secret live in Supabase Vault (set once per environment;
-- docs/decisions.md). Without them the tick does nothing. It only calls the
-- app when something is due, so an idle shop costs nothing.
create extension if not exists pg_net;

create function private.whatsapp_dispatch_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (select 1 from public.message_logs
                  where status = 'queued' and next_retry_at <= now()
                    and (locked_until is null or locked_until < now())) then
    return;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'whatsapp_dispatch_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'whatsapp_dispatch_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000);
end;
$$;

select cron.schedule('whatsapp-dispatch', '* * * * *', 'select private.whatsapp_dispatch_tick()');

-- 7. Grants ---------------------------------------------------------------------
revoke execute on function private.enqueue_order_status_message() from public, anon, authenticated;
revoke execute on function private.enqueue_kyc_result_message() from public, anon, authenticated;
revoke execute on function private.rate_for(text) from public, anon, authenticated;
revoke execute on function private.whatsapp_dispatch_tick() from public, anon, authenticated;

revoke execute on function public.whatsapp_claim(integer, integer) from public, anon, authenticated;
revoke execute on function public.whatsapp_message_context(uuid) from public, anon, authenticated;
revoke execute on function public.whatsapp_mark_sent(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.whatsapp_mark_failure(uuid, text, boolean) from public, anon, authenticated;
revoke execute on function public.whatsapp_log_otp(text, uuid, text) from public, anon, authenticated;
revoke execute on function public.whatsapp_apply_status(text, text, timestamptz, text, text, boolean) from public, anon, authenticated;
grant execute on function public.whatsapp_claim(integer, integer) to service_role;
grant execute on function public.whatsapp_message_context(uuid) to service_role;
grant execute on function public.whatsapp_mark_sent(uuid, text, text) to service_role;
grant execute on function public.whatsapp_mark_failure(uuid, text, boolean) to service_role;
grant execute on function public.whatsapp_log_otp(text, uuid, text) to service_role;
grant execute on function public.whatsapp_apply_status(text, text, timestamptz, text, text, boolean) to service_role;
grant usage on schema private to service_role;
grant execute on function private.rate_for(text) to service_role;

revoke execute on function public.whatsapp_mark_handled(uuid) from public, anon;
revoke execute on function public.whatsapp_retry(uuid) from public, anon;
revoke execute on function public.whatsapp_spend(date, date) from public, anon;
grant execute on function public.whatsapp_mark_handled(uuid) to authenticated;
grant execute on function public.whatsapp_retry(uuid) to authenticated;
grant execute on function public.whatsapp_spend(date, date) to authenticated;
