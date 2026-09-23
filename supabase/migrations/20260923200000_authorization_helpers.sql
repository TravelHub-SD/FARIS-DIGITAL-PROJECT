-- Authorization helpers used by every admin RLS policy.
-- All admin checks go through these three functions; no policy reads the
-- admins table directly. That keeps the 2FA upgrade to one function body.

-- ASSURANCE CHECK POINT (docs/decisions.md, "Admin 2FA deferred").
-- To enforce admin MFA later, change the body to:
--   select coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2';
-- and ship the TOTP enrolment UI. No policy needs to change.
create function private.admin_assurance_ok()
returns boolean
language sql
stable
set search_path = ''
as $$
  select true;
$$;

create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1 from public.admins a
            where a.user_id = (select auth.uid()) and a.is_active
         )
     and private.admin_assurance_ok();
$$;

create function private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1 from public.admins a
            where a.user_id = (select auth.uid()) and a.is_active and a.is_owner
         )
     and private.admin_assurance_ok();
$$;

create function private.has_permission(p_permission public.app_permission)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_owner()
      or (private.is_admin() and exists (
            select 1 from public.admin_permissions ap
             where ap.admin_id = (select auth.uid()) and ap.permission = p_permission
          ));
$$;

-- Functions are executable by PUBLIC by default. Lock down everything in
-- `private`, then allow only what RLS policies and generated columns call.
revoke execute on all functions in schema private from public, anon, authenticated;
grant usage on schema private to anon, authenticated;
grant execute on function private.is_admin() to anon, authenticated;
grant execute on function private.is_owner() to anon, authenticated;
grant execute on function private.has_permission(public.app_permission) to anon, authenticated;
grant execute on function private.admin_assurance_ok() to anon, authenticated;
grant execute on function private.normalize_ar(text) to anon, authenticated;
