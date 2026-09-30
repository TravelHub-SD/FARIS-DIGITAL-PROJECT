-- Storefront redesign (Stage 3, decisions.md 2026-09-30):
--   * category_sections group categories on the home page ("Top-up by ID",
--     "Game cards", …); the admin orders them and assigns categories.
--   * products.is_new: a "New" badge. Display only.
--   * product_variants.compare_at_price_usd: a struck-through "was" price.
--     Display only: it is never read by the order path (the order and line
--     triggers price from price_usd alone), and it is shown only when it is
--     higher than the current price.
--   * promo_banners: several slides for the home slider, replacing the single
--     banner kept in app_settings (copied over, then those columns dropped).

-- 1. Sections -----------------------------------------------------------------
create table public.category_sections (
  id uuid primary key default gen_random_uuid(),
  name_ar text check (char_length(name_ar) <= 80),
  name_en text check (char_length(name_en) <= 80),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (coalesce(name_ar, name_en) is not null)
);

create trigger category_sections_set_updated_at
  before update on public.category_sections
  for each row execute function private.set_updated_at();
create trigger audit_category_sections
  after insert or update or delete on public.category_sections
  for each row execute function private.audit_row();

alter table public.category_sections enable row level security;
grant select on public.category_sections to anon, authenticated;
grant insert, update, delete on public.category_sections to authenticated;
create policy category_sections_select on public.category_sections
  for select to anon, authenticated
  using (is_active or (select private.has_permission('products')));
create policy category_sections_insert on public.category_sections
  for insert to authenticated with check ((select private.has_permission('products')));
create policy category_sections_update on public.category_sections
  for update to authenticated
  using ((select private.has_permission('products')))
  with check ((select private.has_permission('products')));
create policy category_sections_delete on public.category_sections
  for delete to authenticated using ((select private.has_permission('products')));

-- A category belongs to at most one section; deleting a section leaves its
-- categories unassigned (they still appear under "All categories").
alter table public.categories
  add column section_id uuid references public.category_sections (id) on delete set null;
create index categories_section on public.categories (section_id, sort_order);

-- 2. Badges -------------------------------------------------------------------
alter table public.products add column is_new boolean not null default false;
grant insert (is_new), update (is_new) on public.products to authenticated;

alter table public.product_variants
  add column compare_at_price_usd numeric(12, 2) check (compare_at_price_usd > 0);

-- The "was" price in SDG at the current rate (PostgREST computed field:
-- select=...,compare_at_sdg), same rounding as price_sdg. NULL unless it is
-- above the current price, so a stale compare-at never shows a fake discount.
create function public.compare_at_sdg(v public.product_variants)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select ceil(v.compare_at_price_usd * s.usd_sdg_rate)
    from public.app_settings s
   where s.id and v.compare_at_price_usd > v.price_usd;
$$;
revoke execute on function public.compare_at_sdg(public.product_variants) from public;
grant execute on function public.compare_at_sdg(public.product_variants) to anon, authenticated;

-- 3. Promo banners ------------------------------------------------------------
create table public.promo_banners (
  id uuid primary key default gen_random_uuid(),
  title_ar text check (char_length(title_ar) <= 120),
  title_en text check (char_length(title_en) <= 120),
  subtitle_ar text check (char_length(subtitle_ar) <= 200),
  subtitle_en text check (char_length(subtitle_en) <= 200),
  image_path text,
  link text check (link is null or link ~ '^(/[^[:space:]]*|https://[^[:space:]]+)$'),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A slide shows at least a title or an image.
  check (coalesce(title_ar, title_en, image_path) is not null)
);

create trigger promo_banners_set_updated_at
  before update on public.promo_banners
  for each row execute function private.set_updated_at();
create trigger audit_promo_banners
  after insert or update or delete on public.promo_banners
  for each row execute function private.audit_row();

alter table public.promo_banners enable row level security;
grant select on public.promo_banners to anon, authenticated;
grant insert (title_ar, title_en, subtitle_ar, subtitle_en, image_path, link, sort_order, is_active),
      update (title_ar, title_en, subtitle_ar, subtitle_en, image_path, link, sort_order, is_active),
      delete
  on public.promo_banners to authenticated;
create policy promo_banners_select on public.promo_banners
  for select to anon, authenticated
  using (is_active or (select private.has_permission('settings')));
create policy promo_banners_insert on public.promo_banners
  for insert to authenticated with check ((select private.has_permission('settings')));
create policy promo_banners_update on public.promo_banners
  for update to authenticated
  using ((select private.has_permission('settings')))
  with check ((select private.has_permission('settings')));
create policy promo_banners_delete on public.promo_banners
  for delete to authenticated using ((select private.has_permission('settings')));

-- The single banner becomes the first slide (same text, image and link).
insert into public.promo_banners (title_ar, title_en, image_path, link, is_active)
select s.banner_title_ar, s.banner_title_en, s.banner_image_path, s.banner_link, s.banner_is_active
  from public.app_settings s
 where s.id and coalesce(s.banner_title_ar, s.banner_title_en, s.banner_image_path) is not null;

alter table public.app_settings
  drop column banner_title_ar,
  drop column banner_title_en,
  drop column banner_image_path,
  drop column banner_link,
  drop column banner_is_active;

-- 4. Product cards: "New", a short description and the "was" price ----------
-- The card's compare-at belongs to the cheapest package (the one whose price
-- the card shows), and appears only when above that price.
drop function public.search_products(text, text, numeric, numeric, text, integer, integer);
create function public.search_products(
  p_query text default null,
  p_category text default null,
  p_min_sdg numeric default null,
  p_max_sdg numeric default null,
  p_sort text default 'popular',
  p_limit integer default 24,
  p_offset integer default 0
)
returns table (
  id uuid,
  slug text,
  category_slug text,
  category_name_ar text,
  category_name_en text,
  name_ar text,
  name_en text,
  description_ar text,
  description_en text,
  image_path text,
  is_new boolean,
  min_price_usd numeric,
  min_price_sdg numeric,
  compare_at_sdg numeric,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with settings as (
    select s.usd_sdg_rate as rate from public.app_settings s where s.id
  ),
  term as (
    select nullif(private.normalize_ar(btrim(left(coalesce(p_query, ''), 100))), '') as t
  ),
  base as (
    select p.id, p.slug, c.slug as category_slug, c.name_ar as category_name_ar,
           c.name_en as category_name_en, p.name_ar, p.name_en,
           left(p.description_ar, 160) as description_ar, left(p.description_en, 160) as description_en,
           p.image_path, p.is_new, p.completed_orders_count, p.created_at, p.sort_order,
           min(v.price_usd) as min_price_usd,
           (array_agg(v.compare_at_price_usd order by v.price_usd, v.sort_order))[1] as cheapest_compare_usd
      from public.products p
      join public.categories c on c.id = p.category_id
      join public.product_variants v on v.product_id = p.id
     where (p_category is null or c.slug = p_category)
       and ((select t from term) is null
            or p.search_text like '%' || replace(replace(replace((select t from term), '\', '\\'), '%', '\%'), '_', '\_') || '%')
     group by p.id, c.id
  ),
  priced as (
    select b.*, ceil(b.min_price_usd * (select rate from settings)) as min_price_sdg,
           case when b.cheapest_compare_usd > b.min_price_usd
                then ceil(b.cheapest_compare_usd * (select rate from settings)) end as compare_at_sdg
      from base b
  )
  select pr.id, pr.slug, pr.category_slug, pr.category_name_ar, pr.category_name_en,
         pr.name_ar, pr.name_en, pr.description_ar, pr.description_en, pr.image_path, pr.is_new,
         pr.min_price_usd, pr.min_price_sdg, pr.compare_at_sdg,
         count(*) over () as total_count
    from priced pr
   where (p_min_sdg is null or pr.min_price_sdg >= p_min_sdg)
     and (p_max_sdg is null or pr.min_price_sdg <= p_max_sdg)
   order by
     case when p_sort = 'price_asc' then pr.min_price_usd end asc nulls last,
     case when p_sort = 'price_desc' then pr.min_price_usd end desc nulls last,
     case when p_sort = 'newest' then pr.created_at end desc nulls last,
     pr.completed_orders_count desc, pr.sort_order, pr.slug
   limit least(greatest(coalesce(p_limit, 24), 1), 48)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
revoke execute on function public.search_products(text, text, numeric, numeric, text, integer, integer) from public;
grant execute on function public.search_products(text, text, numeric, numeric, text, integer, integer) to anon, authenticated;
