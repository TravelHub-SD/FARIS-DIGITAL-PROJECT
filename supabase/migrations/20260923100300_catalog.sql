-- Catalog: categories → products → variants. Prices are USD (decisions.md).

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name_ar text check (char_length(name_ar) <= 120),
  name_en text check (char_length(name_en) <= 120),
  description_ar text check (char_length(description_ar) <= 2000),
  description_en text check (char_length(description_en) <= 2000),
  image_path text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (coalesce(name_ar, name_en) is not null)
);

create index categories_visible_sort on public.categories (sort_order)
  where is_active and archived_at is null;

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function private.set_updated_at();

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name_ar text check (char_length(name_ar) <= 160),
  name_en text check (char_length(name_en) <= 160),
  description_ar text check (char_length(description_ar) <= 8000),
  description_en text check (char_length(description_en) <= 8000),
  image_path text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  archived_at timestamptz,
  completed_orders_count integer not null default 0 check (completed_orders_count >= 0),
  search_text text generated always as (
    private.normalize_ar(coalesce(name_ar, '') || ' ' || coalesce(name_en, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (coalesce(name_ar, name_en) is not null)
);

create index products_category_visible on public.products (category_id, sort_order)
  where is_active and archived_at is null;
create index products_popular on public.products (completed_orders_count desc)
  where is_active and archived_at is null;
create index products_search_trgm on public.products
  using gin (search_text extensions.gin_trgm_ops);

create trigger products_set_updated_at
  before update on public.products
  for each row execute function private.set_updated_at();

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  name_ar text check (char_length(name_ar) <= 160),
  name_en text check (char_length(name_en) <= 160),
  price_usd numeric(12, 2) not null check (price_usd > 0),
  -- Fulfillment field definitions; shape validated by the app's Zod meta-schema.
  required_fields jsonb not null default '[]' check (jsonb_typeof(required_fields) = 'array'),
  max_quantity smallint not null default 1 check (max_quantity between 1 and 10),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (coalesce(name_ar, name_en) is not null)
);

create index product_variants_product_visible on public.product_variants (product_id, sort_order)
  where is_active and archived_at is null;

create trigger product_variants_set_updated_at
  before update on public.product_variants
  for each row execute function private.set_updated_at();
