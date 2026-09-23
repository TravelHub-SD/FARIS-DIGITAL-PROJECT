-- Product comments, WhatsApp message log, OTP and rate-limit tables.

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  status public.comment_status not null default 'visible',
  hidden_by uuid references public.profiles (id),
  hidden_reason text check (char_length(hidden_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index comments_product_visible on public.comments (product_id, created_at desc)
  where status = 'visible';
create index comments_user on public.comments (user_id);
create index comments_moderation on public.comments (status, created_at desc);

create trigger comments_set_updated_at
  before update on public.comments
  for each row execute function private.set_updated_at();

create table public.message_logs (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  user_id uuid references public.profiles (id) on delete set null,
  message_type public.message_type not null,
  template_name text not null,
  order_id uuid references public.orders (id) on delete set null,
  provider_message_id text unique,
  status public.message_status not null default 'queued',
  error_code text,
  error_message text check (char_length(error_message) <= 1000),
  attempts smallint not null default 0 check (attempts >= 0),
  next_retry_at timestamptz,
  estimated_cost_usd numeric(8, 4) check (estimated_cost_usd >= 0),
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- CLAUDE.md rule 9: an OTP message log never carries a payload (no code).
  constraint message_logs_no_otp_payload check (message_type <> 'otp' or payload = '{}'::jsonb)
);

create index message_logs_retry on public.message_logs (status, next_retry_at);
create index message_logs_order on public.message_logs (order_id);
create index message_logs_created on public.message_logs (created_at desc);

create trigger message_logs_set_updated_at
  before update on public.message_logs
  for each row execute function private.set_updated_at();

-- Private: never reachable through the Data API.
create table private.otp_codes (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  purpose public.otp_purpose not null,
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  attempts smallint not null default 0 check (attempts >= 0),
  max_attempts smallint not null default 5 check (max_attempts between 1 and 10),
  consumed_at timestamptz,
  ip inet,
  created_at timestamptz not null default now()
);

create index otp_codes_lookup on private.otp_codes (phone_e164, purpose, created_at desc);
create index otp_codes_ip on private.otp_codes (ip, created_at);

create table private.rate_limit_events (
  id bigint generated always as identity primary key,
  bucket text not null,
  key text not null,
  created_at timestamptz not null default now()
);

create index rate_limit_events_lookup on private.rate_limit_events (bucket, key, created_at);
