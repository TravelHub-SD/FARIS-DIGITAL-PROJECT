-- Admin two-factor authentication (decisions.md 2026-09-28).
--
-- Every admin policy and function goes through private.is_admin() /
-- is_owner() / has_permission(), which all require admin_assurance_ok().
-- From now on that means the caller's session was upgraded with an
-- authenticator code (JWT claim aal = aal2). A staff member signed in with a
-- password only is, to the database, not an admin: every admin read returns
-- nothing and every admin function raises, through PostgREST as through the
-- site. Customers are unaffected (their policies never call these helpers).

create or replace function private.admin_assurance_ok()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2';
$$;

-- Owner resets a staff member's 2FA (lost or stolen phone): removes every
-- authenticator of that person and ends all their sessions, so a stolen
-- phone or an open browser stops working at once. The person enrols again
-- at the next sign-in. The owner cannot reset themself here: with no working
-- authenticator they could not reach this page anyway (see break_glass below).
create function public.admin_reset_mfa(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_factors integer;
begin
  if not private.is_owner() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_user_id = (select auth.uid()) then
    raise exception 'CANNOT_RESET_SELF' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.admins where user_id = p_user_id) then
    raise exception 'NOT_STAFF' using errcode = 'P0002';
  end if;
  delete from auth.mfa_factors where user_id = p_user_id;
  get diagnostics v_factors = row_count;
  delete from auth.sessions where user_id = p_user_id;
  insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, new_data)
  values ((select auth.uid()), 'authenticated', 'admins.mfa_reset', 'admins',
          p_user_id::text, jsonb_build_object('factors_removed', v_factors));
end;
$$;
revoke execute on function public.admin_reset_mfa(uuid) from public, anon;
grant execute on function public.admin_reset_mfa(uuid) to authenticated;

-- Break glass: the owner lost every authenticator. Only a database session
-- (Supabase SQL editor, held by the project owner) can run it; no API role
-- has EXECUTE. Identify the person by phone, as it appears in Auth
-- (digits, no '+'):
--   select private.break_glass_reset_mfa('2499XXXXXXXX');
create function private.break_glass_reset_mfa(p_phone text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_factors integer;
begin
  select u.id into v_user
    from auth.users u join public.admins a on a.user_id = u.id
   where u.phone = ltrim(p_phone, '+');
  if v_user is null then
    raise exception 'NOT_STAFF' using errcode = 'P0002';
  end if;
  delete from auth.mfa_factors where user_id = v_user;
  get diagnostics v_factors = row_count;
  delete from auth.sessions where user_id = v_user;
  insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, new_data)
  values (null, session_user::text, 'admins.mfa_break_glass', 'admins',
          v_user::text, jsonb_build_object('factors_removed', v_factors));
  return v_factors;
end;
$$;
revoke execute on function private.break_glass_reset_mfa(text) from public, anon, authenticated;

-- GoTrue names a TOTP factor after the user's email (the label shown in the
-- authenticator app) and refuses to enrol a user without one (checked in
-- supabase/auth v2.196.0 and main: AccountName = user.GetEmail()). Staff
-- sign in by phone and have no email. Before enrolling, the signed-in staff
-- member gets a label address on the reserved .invalid domain (RFC 2606: it
-- can never receive mail). It is not a login: the email provider is off.
-- Only active staff, only their own account, only if they have no email.
create function public.staff_totp_label()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text;
begin
  if not exists (select 1 from public.admins a
                  where a.user_id = (select auth.uid()) and a.is_active) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update auth.users u
     set email = u.phone || '@staff.invalid',
         email_confirmed_at = coalesce(u.email_confirmed_at, now())
   where u.id = (select auth.uid()) and u.email is null and u.phone is not null;
  select u.email into v_label from auth.users u where u.id = (select auth.uid());
  return v_label;
end;
$$;
revoke execute on function public.staff_totp_label() from public, anon;
grant execute on function public.staff_totp_label() to authenticated;
