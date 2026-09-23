-- Identity: customer profiles, admins, per-area admin permissions.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (full_name is null or char_length(full_name) between 2 and 100),
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  phone_verified_at timestamptz,
  locale text not null default 'ar' check (locale in ('ar', 'en')),
  kyc_status public.kyc_status not null default 'none',
  kyc_rejection_reason text check (char_length(kyc_rejection_reason) <= 500),
  is_blocked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_verified_phone_present
    check (phone_verified_at is null or phone_e164 is not null)
);

create unique index profiles_phone_e164_key
  on public.profiles (phone_e164) where phone_e164 is not null;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- Profile row is created for every auth user. GoTrue stores phones without '+'.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(btrim(new.raw_user_meta_data ->> 'full_name'), '');
begin
  insert into public.profiles (id, full_name, phone_e164, phone_verified_at, locale)
  values (
    new.id,
    case when char_length(v_name) between 2 and 100 then v_name end,
    case when coalesce(new.phone, '') <> '' then '+' || new.phone end,
    case when coalesce(new.phone, '') <> '' then new.phone_confirmed_at end,
    case when new.raw_user_meta_data ->> 'locale' = 'en' then 'en' else 'ar' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Keep the verified phone in sync when it changes in Auth (phone change flow).
create function private.sync_user_phone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set phone_e164 = case when coalesce(new.phone, '') <> '' then '+' || new.phone end,
         phone_verified_at = case when coalesce(new.phone, '') <> '' then new.phone_confirmed_at end
   where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_phone_changed
  after update of phone, phone_confirmed_at on auth.users
  for each row
  when (old.phone is distinct from new.phone
        or old.phone_confirmed_at is distinct from new.phone_confirmed_at)
  execute function private.sync_user_phone();

create table public.admins (
  user_id uuid primary key references public.profiles (id) on delete restrict,
  is_owner boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Exactly one owner can exist.
create unique index admins_single_owner on public.admins (is_owner) where is_owner;

create trigger admins_set_updated_at
  before update on public.admins
  for each row execute function private.set_updated_at();

create function private.protect_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_owner then
      raise exception 'OWNER_PROTECTED: the owner cannot be removed' using errcode = '42501';
    end if;
    return old;
  end if;
  if new.is_owner is distinct from old.is_owner then
    raise exception 'OWNER_PROTECTED: is_owner cannot be changed' using errcode = '42501';
  end if;
  if old.is_owner and not new.is_active then
    raise exception 'OWNER_PROTECTED: the owner cannot be deactivated' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger admins_protect_owner
  before update or delete on public.admins
  for each row execute function private.protect_owner();

create table public.admin_permissions (
  admin_id uuid not null references public.admins (user_id) on delete cascade,
  permission public.app_permission not null,
  granted_by uuid references public.profiles (id),
  granted_at timestamptz not null default now(),
  primary key (admin_id, permission)
);
