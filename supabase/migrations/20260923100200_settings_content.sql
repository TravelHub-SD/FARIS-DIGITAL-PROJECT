-- Settings (single typed rows), bank accounts, FAQs.

-- Customer-visible configuration. Money rules (rate, KYC threshold) are read
-- by database triggers, never taken from the browser.
create table public.app_settings (
  id boolean primary key default true check (id),
  usd_sdg_rate numeric(14, 4) check (usd_sdg_rate > 0),
  usd_sdg_rate_updated_at timestamptz,
  kyc_threshold_usd numeric(12, 2) check (kyc_threshold_usd >= 0),
  contact_phone text check (char_length(contact_phone) <= 32),
  contact_whatsapp text check (char_length(contact_whatsapp) <= 32),
  contact_email text check (char_length(contact_email) <= 254),
  address_ar text check (char_length(address_ar) <= 300),
  address_en text check (char_length(address_en) <= 300),
  social_links jsonb not null default '{}' check (jsonb_typeof(social_links) = 'object'),
  banner_title_ar text check (char_length(banner_title_ar) <= 200),
  banner_title_en text check (char_length(banner_title_en) <= 200),
  banner_image_path text,
  banner_link text check (banner_link is null or banner_link ~ '^(/|https://)'),
  banner_is_active boolean not null default false,
  logo_path text,
  updated_at timestamptz not null default now()
);

-- Values are NULL until the owner sets them; order creation refuses to run
-- while the rate or KYC threshold is missing.
insert into public.app_settings (id) values (true);

create function private.app_settings_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.usd_sdg_rate is distinct from old.usd_sdg_rate then
    new.usd_sdg_rate_updated_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger app_settings_before_update
  before update on public.app_settings
  for each row execute function private.app_settings_before_update();

-- Security-relevant settings, readable only by settings admins.
create table public.security_settings (
  id boolean primary key default true check (id),
  otp_login_policy text not null default 'never' check (otp_login_policy in ('never', 'always')),
  allowed_phone_country_codes text[] not null default '{249}'
    check (cardinality(allowed_phone_country_codes) between 1 and 20),
  otp_daily_budget integer not null default 300 check (otp_daily_budget between 0 and 100000),
  updated_at timestamptz not null default now()
);

insert into public.security_settings (id) values (true);

create trigger security_settings_set_updated_at
  before update on public.security_settings
  for each row execute function private.set_updated_at();

create function private.forbid_delete_singleton()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'SINGLETON_ROW: % cannot be deleted', tg_table_name using errcode = '42501';
end;
$$;

create trigger app_settings_no_delete
  before delete on public.app_settings
  for each row execute function private.forbid_delete_singleton();

create trigger security_settings_no_delete
  before delete on public.security_settings
  for each row execute function private.forbid_delete_singleton();

create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  bank_name_ar text not null check (char_length(bank_name_ar) <= 120),
  bank_name_en text not null check (char_length(bank_name_en) <= 120),
  account_number text not null check (account_number ~ '^[0-9A-Za-z-]{3,40}$'),
  account_holder text not null check (char_length(account_holder) <= 120),
  branch_ar text check (char_length(branch_ar) <= 120),
  branch_en text check (char_length(branch_en) <= 120),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bank_name_en, account_number)
);

create trigger bank_accounts_set_updated_at
  before update on public.bank_accounts
  for each row execute function private.set_updated_at();

-- Real receiving accounts from docs/spec.md §10 (production data, not seed).
-- Arabic branch names are translations pending client confirmation.
insert into public.bank_accounts
  (bank_name_ar, bank_name_en, account_number, account_holder, branch_ar, branch_en, sort_order)
values
  ('بنك الخرطوم (بنكك)', 'Bank of Khartoum (Bankak)', '3121407', 'فارس حسن عمر خالد',
   'فرع سعد قشرة', 'Saad Gishra branch', 1),
  ('بنك فيصل الإسلامي (فوري)', 'Faisal Islamic Bank (Fawry)', '51575057', 'فارس حسن عمر خالد',
   'فرع بورتسودان', 'Port Sudan branch', 2),
  ('بنك النيل (ساحل)', 'Bank of Nile (Sahel)', '27098', 'فارس حسن عمر خالد',
   'فرع بحري الصناعات', 'Bahri Industrial branch', 3);

create table public.faqs (
  id uuid primary key default gen_random_uuid(),
  question_ar text check (char_length(question_ar) <= 300),
  question_en text check (char_length(question_en) <= 300),
  answer_ar text check (char_length(answer_ar) <= 4000),
  answer_en text check (char_length(answer_en) <= 4000),
  sort_order integer not null default 0,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (coalesce(question_ar, question_en) is not null),
  check (coalesce(answer_ar, answer_en) is not null)
);

create index faqs_published_sort on public.faqs (sort_order) where is_published;

create trigger faqs_set_updated_at
  before update on public.faqs
  for each row execute function private.set_updated_at();
