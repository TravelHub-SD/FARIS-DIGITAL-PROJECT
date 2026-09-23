-- Acceptance test 1: no account may exist without a verified OTP.
--
-- Layer 1 is Auth config (supabase/config.toml: [auth] enable_signup = false).
-- Layer 2 (this trigger) holds even if that toggle is misconfigured on the
-- hosted project: every new auth.users row must carry the app_metadata marker
-- `signup_verified = 'otp'` by the time its transaction commits. Only the
-- server can set app_metadata (service role, after OTP verification); public
-- signUp can only set user_metadata. Anonymous and OAuth sign-ups without the
-- marker are rejected too.
--
-- Why DEFERRED: GoTrue's admin createUser inserts the user first and writes
-- app_metadata with a second statement in the same transaction. A plain
-- BEFORE INSERT trigger sees the row before the marker exists. A deferred
-- constraint trigger checks the row's final state at COMMIT.

create function private.guard_auth_user_insert()
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
    return null; -- row already removed within the same transaction
  end if;
  if coalesce(v_meta ->> 'signup_verified', '') <> 'otp' then
    raise exception 'SIGNUP_NOT_ALLOWED'
      using errcode = '42501',
            hint = 'Accounts are created only by the server after OTP verification.';
  end if;
  return null;
end;
$$;

revoke execute on function private.guard_auth_user_insert() from public, anon, authenticated;

create constraint trigger guard_auth_user_insert
  after insert on auth.users
  deferrable initially deferred
  for each row execute function private.guard_auth_user_insert();
