-- Phase 3: GoTrue hooks and the updated sign-up guard.
-- Hooks live in `private` (not exposed by the Data API) and are executable
-- only by supabase_auth_admin, the role GoTrue uses to call them.

-- Layer 1: reject every public account creation except Google OAuth.
-- GoTrue does not call this hook for the admin API, which is how the server
-- creates accounts after OTP verification (verified in Phase 3).
create function private.auth_hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  if coalesce(event -> 'user' -> 'app_metadata' ->> 'provider', '') = 'google' then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'Accounts are created through phone registration with a verified code.'
  ));
end;
$$;

-- GoTrue must never send SMS: the payload contains a plaintext OTP and any
-- delivery would be a second login path outside our OTP limits. Refusing here
-- disables GoTrue phone OTP login, phone-change codes and SMS confirmations.
-- The event is deliberately neither stored nor logged.
create function private.auth_hook_send_sms(event jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
begin
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'SMS delivery is disabled. Codes are sent by the application over WhatsApp.'
  ));
end;
$$;

revoke execute on function private.auth_hook_before_user_created(jsonb) from public, anon, authenticated;
revoke execute on function private.auth_hook_send_sms(jsonb) from public, anon, authenticated;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.auth_hook_before_user_created(jsonb) to supabase_auth_admin;
grant execute on function private.auth_hook_send_sms(jsonb) to supabase_auth_admin;

-- Layer 2 (updated): a new user must, by COMMIT, either carry the server's
-- OTP marker or come from Google OAuth. Google accounts start INCOMPLETE
-- (no verified phone) and are unusable until the phone OTP step.
create or replace function private.guard_auth_user_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb;
begin
  select u.raw_app_meta_data into v_meta from auth.users u where u.id = new.id;
  if not found then
    return null;
  end if;
  if coalesce(v_meta ->> 'signup_verified', '') = 'otp'
     or coalesce(v_meta ->> 'provider', '') = 'google' then
    return null;
  end if;
  raise exception 'SIGNUP_NOT_ALLOWED'
    using errcode = '42501',
          hint = 'Accounts are created only by the server after OTP verification, or by Google sign-in.';
end;
$$;
