-- Foundation: schemas, extensions, shared utility functions, enums.
-- `private` holds internal tables and functions. It is not in the Data API's
-- exposed schemas (supabase/config.toml [api].schemas), so PostgREST cannot
-- reach it; grants below are a second layer.

create schema if not exists private;
revoke all on schema private from public;

create extension if not exists pg_trgm with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- Generic updated_at maintenance.
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Arabic-aware search normalisation: folds alef/taa marbuta/alef maqsura
-- variants and strips tashkeel + tatweel so "أيفون" matches "ايفون".
create function private.normalize_ar(input text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(
    regexp_replace(
      translate(coalesce(input, ''), 'أإآٱةى', 'ااااهي'),
      '[ً-ٰٟـ]', '', 'g'
    )
  );
$$;

create type public.kyc_status as enum ('none', 'pending', 'verified', 'rejected');
create type public.kyc_doc_type as enum ('national_id', 'passport', 'driving_license');
create type public.review_status as enum ('pending', 'accepted', 'rejected');
create type public.app_permission as enum (
  'orders', 'products', 'kyc', 'customers', 'invoices', 'comments', 'settings'
);
create type public.otp_purpose as enum ('register', 'reset_password', 'link_phone', 'change_phone');
create type public.message_type as enum ('otp', 'order_status', 'kyc_result');
create type public.message_status as enum ('queued', 'sent', 'delivered', 'read', 'failed');
create type public.invoice_status as enum ('issued', 'void');
create type public.comment_status as enum ('visible', 'hidden');
