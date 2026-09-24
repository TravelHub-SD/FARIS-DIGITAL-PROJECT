-- Phase 3: OTP issue/verify and rate limiting, atomic in the database.
-- The application generates the code and sends only an HMAC of it here, so
-- the database never sees a plaintext code. All functions are callable by
-- service_role only (the server), never by anon/authenticated.

create index otp_codes_created on private.otp_codes (created_at);

-- Issue a code. Returns {ok:true, otp_id} or {ok:false, reason, retry_after}.
-- Limits: 60 s cooldown per phone, 5/hour and 10/day per phone, 10/hour per
-- IP, and a global daily budget (security_settings.otp_daily_budget) that
-- caps what an attacker can burn on WhatsApp.
create function public.otp_issue(
  p_phone text,
  p_purpose public.otp_purpose,
  p_code_hash text,
  p_ip inet default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_cooldown constant interval := interval '60 seconds';
  c_ttl constant interval := interval '5 minutes';
  v_settings public.security_settings;
  v_last timestamptz;
  v_oldest_hour timestamptz;
  v_hour integer;
  v_day integer;
  v_ip_hour integer;
  v_today integer;
  v_id uuid;
begin
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_phone');
  end if;
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_CODE_HASH' using errcode = '22023';
  end if;

  select * into v_settings from public.security_settings where id;
  if not exists (
    select 1 from unnest(v_settings.allowed_phone_country_codes) as cc
     where p_phone like '+' || cc || '%'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'country_not_allowed');
  end if;

  -- Serialise issuance so concurrent requests cannot race past any limit.
  perform pg_advisory_xact_lock(hashtextextended('faris:otp_issue', 0));

  select max(created_at),
         min(created_at) filter (where created_at > now() - interval '1 hour'),
         count(*) filter (where created_at > now() - interval '1 hour'),
         count(*)
    into v_last, v_oldest_hour, v_hour, v_day
    from private.otp_codes
   where phone_e164 = p_phone and created_at > now() - interval '24 hours';

  if v_last is not null and v_last > now() - c_cooldown then
    return jsonb_build_object('ok', false, 'reason', 'cooldown',
      'retry_after', ceil(extract(epoch from (v_last + c_cooldown - now())))::integer);
  end if;
  if v_hour >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'phone_hourly_limit',
      'retry_after', ceil(extract(epoch from (v_oldest_hour + interval '1 hour' - now())))::integer);
  end if;
  if v_day >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'phone_daily_limit');
  end if;

  if p_ip is not null then
    select count(*) into v_ip_hour from private.otp_codes
     where ip = p_ip and created_at > now() - interval '1 hour';
    if v_ip_hour >= 10 then
      return jsonb_build_object('ok', false, 'reason', 'ip_hourly_limit');
    end if;
  end if;

  select count(*) into v_today from private.otp_codes
   where created_at >= (date_trunc('day', now() at time zone 'Africa/Khartoum') at time zone 'Africa/Khartoum');
  if v_today >= v_settings.otp_daily_budget then
    return jsonb_build_object('ok', false, 'reason', 'budget_exhausted');
  end if;

  insert into private.otp_codes (phone_e164, purpose, code_hash, expires_at, ip)
  values (p_phone, p_purpose, p_code_hash, now() + c_ttl, p_ip)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'otp_id', v_id,
    'expires_in', extract(epoch from c_ttl)::integer);
end;
$$;

-- Verify a code. Only the NEWEST code for (phone, purpose) is valid; a new
-- request invalidates older ones. Each call counts an attempt BEFORE comparing
-- (the function returns instead of raising, so the increment always commits).
-- After max_attempts (5) the code is dead even if the right code arrives.
-- Failed attempts per IP are capped at 30/hour across all phones.
create function public.otp_verify(
  p_phone text,
  p_purpose public.otp_purpose,
  p_code_hash text,
  p_ip inet default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code private.otp_codes;
  v_ip_failures integer;
begin
  if p_ip is not null then
    select count(*) into v_ip_failures from private.rate_limit_events
     where bucket = 'otp_verify_fail_ip' and key = host(p_ip)
       and created_at > now() - interval '1 hour';
    if v_ip_failures >= 30 then
      return jsonb_build_object('ok', false, 'reason', 'ip_verify_limit');
    end if;
  end if;

  select * into v_code from private.otp_codes
   where phone_e164 = p_phone and purpose = p_purpose
   order by created_at desc
   limit 1
   for update;

  if not found or v_code.consumed_at is not null or v_code.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'invalid_or_expired');
  end if;
  if v_code.attempts >= v_code.max_attempts then
    return jsonb_build_object('ok', false, 'reason', 'too_many_attempts');
  end if;

  update private.otp_codes set attempts = attempts + 1 where id = v_code.id;

  if v_code.code_hash = p_code_hash then
    update private.otp_codes set consumed_at = now() where id = v_code.id;
    return jsonb_build_object('ok', true, 'otp_id', v_code.id);
  end if;

  if p_ip is not null then
    insert into private.rate_limit_events (bucket, key) values ('otp_verify_fail_ip', host(p_ip));
  end if;

  if v_code.attempts + 1 >= v_code.max_attempts then
    return jsonb_build_object('ok', false, 'reason', 'too_many_attempts');
  end if;
  return jsonb_build_object('ok', false, 'reason', 'invalid_code',
    'attempts_left', v_code.max_attempts - v_code.attempts - 1);
end;
$$;

-- Generic counters for login throttling and similar.
create function public.rate_limit_exceeded(p_bucket text, p_key text, p_max integer, p_window_seconds integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) >= p_max from private.rate_limit_events
   where bucket = p_bucket and key = p_key
     and created_at > now() - make_interval(secs => p_window_seconds);
$$;

create function public.rate_limit_record(p_bucket text, p_key text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.rate_limit_events (bucket, key) values (p_bucket, p_key);
$$;

create function public.rate_limit_clear(p_bucket text, p_key text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.rate_limit_events where bucket = p_bucket and key = p_key;
$$;

-- Account lookups the server needs during OTP flows.
create function public.auth_user_id_by_phone(p_phone text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from auth.users u where u.phone = ltrim(p_phone, '+') limit 1;
$$;

-- Revoke every session of a user (after a password reset).
create function public.auth_revoke_sessions(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Nightly cleanup: incomplete accounts (Google sign-in without a verified
-- phone) older than 24 h are deleted. They can hold no orders, KYC or
-- comments (all require a verified phone), so nothing of value is lost.
create function private.purge_incomplete_accounts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from auth.users u
   using public.profiles p
   where p.id = u.id
     and p.phone_verified_at is null
     and u.created_at < now() - interval '24 hours'
     and not exists (select 1 from public.admins a where a.user_id = u.id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Old rate-limit events and dead OTP rows are pruned daily as well.
create function private.prune_auth_tables()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.rate_limit_events where created_at < now() - interval '2 days';
  delete from private.otp_codes where created_at < now() - interval '2 days';
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.otp_issue(text, public.otp_purpose, text, inet)',
    'public.otp_verify(text, public.otp_purpose, text, inet)',
    'public.rate_limit_exceeded(text, text, integer, integer)',
    'public.rate_limit_record(text, text)',
    'public.rate_limit_clear(text, text)',
    'public.auth_user_id_by_phone(text)',
    'public.auth_revoke_sessions(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

revoke execute on function private.purge_incomplete_accounts() from public, anon, authenticated;
revoke execute on function private.prune_auth_tables() from public, anon, authenticated;

-- Scheduling with pg_cron (available on the Supabase free tier).
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('purge-incomplete-accounts', '17 3 * * *', 'select private.purge_incomplete_accounts()');
select cron.schedule('prune-auth-tables', '27 3 * * *', 'select private.prune_auth_tables()');
