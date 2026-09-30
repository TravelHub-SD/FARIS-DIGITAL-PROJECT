-- About / Terms / Privacy (spec §3 "Static pages"; decisions.md 2026-09-28).
-- A fixed set of pages whose texts the client edits in the dashboard, with
-- the FAQ permission model: anyone reads published pages, settings staff
-- read and edit all of them. Nobody adds or deletes pages: the three rows
-- are created here and the site links to exactly these three.
-- Texts are plain text (paragraphs separated by blank lines), never HTML.

create table public.site_pages (
  slug text primary key check (slug in ('about', 'terms', 'privacy')),
  title_ar text check (char_length(title_ar) <= 150),
  title_en text check (char_length(title_en) <= 150),
  body_ar text check (char_length(body_ar) <= 30000),
  body_en text check (char_length(body_en) <= 30000),
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A page can only go live with a title and a text in at least one
  -- language (the other falls back, like the rest of the site).
  check (
    not is_published
    or (coalesce(title_ar, title_en) is not null
        and coalesce(body_ar, body_en) is not null)
  )
);

-- The audit log names each row by its key; these rows are keyed by slug.
create or replace function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_excluded text[] := coalesce(tg_argv::text[], '{}') || array['updated_at'];
  v_row jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  v_old jsonb;
  v_new jsonb;
  v_changed text[];
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old := to_jsonb(old) - v_excluded;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new := to_jsonb(new) - v_excluded;
  end if;

  if tg_op = 'UPDATE' then
    select coalesce(array_agg(k), '{}') into v_changed
      from jsonb_object_keys(v_new) as k
     where v_new -> k is distinct from v_old -> k;
    if cardinality(v_changed) = 0 then
      return null;
    end if;
    select jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k)
      into v_old, v_new
      from unnest(v_changed) as k;
  end if;

  insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, old_data, new_data)
  values (
    (select auth.uid()),
    coalesce((select auth.jwt() ->> 'role'), session_user::text),
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'user_id', v_row ->> 'admin_id', v_row ->> 'slug'),
    v_old,
    v_new
  );
  return null;
end;
$$;

create trigger site_pages_set_updated_at
  before update on public.site_pages
  for each row execute function private.set_updated_at();

create trigger audit_site_pages
  after insert or update or delete on public.site_pages
  for each row execute function private.audit_row();

insert into public.site_pages (slug) values ('about'), ('terms'), ('privacy');

alter table public.site_pages enable row level security;

grant select on public.site_pages to anon, authenticated;
grant update (title_ar, title_en, body_ar, body_en, is_published)
  on public.site_pages to authenticated;

create policy site_pages_select on public.site_pages
  for select to anon, authenticated
  using (is_published or (select private.has_permission('settings')));
create policy site_pages_update on public.site_pages
  for update to authenticated
  using ((select private.has_permission('settings')))
  with check ((select private.has_permission('settings')));
