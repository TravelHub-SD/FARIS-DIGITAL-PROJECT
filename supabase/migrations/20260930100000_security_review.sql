-- Phase 10 security review (docs/security-review.md, finding F1).
--
-- Comments are shown publicly only through public.product_comments(): visible
-- comments of visible products, author's first name only. Reading the table
-- directly through the API also returned user_id, a stable identifier that
-- links every comment of one customer together, and visible comments of
-- hidden or archived products. Now only the author and comment moderators
-- read rows; everyone else goes through the function.

revoke select on public.comments from anon;

drop policy comments_select on public.comments;
create policy comments_select on public.comments
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.has_permission('comments'))
  );

-- Finding F3 (advisor 0014 "extension in public"): pg_net was created without
-- a schema, so the extension was registered in public. Everything it owns
-- lives in schema net, so callers (net.http_post in the WhatsApp scheduler)
-- are unaffected. It is not relocatable, hence drop + create; at worst an
-- in-flight scheduler call is dropped, and the next minute's tick repeats it.
drop extension if exists pg_net;
create extension pg_net with schema extensions;

-- Finding F4: when the global OTP daily budget (the cap that stops anyone
-- burning the WhatsApp budget) is used up, every registration and password
-- reset is refused until midnight Khartoum time, and nobody was told. Settings
-- staff (who can raise the budget) now see today's count on every admin page.
-- Counts exactly what otp_issue() counts.
create function public.otp_budget_today()
returns table (used integer, budget integer)
language sql
stable
security definer
set search_path = ''
as $$
  select (select count(*)::integer from private.otp_codes
           where created_at >= (date_trunc('day', now() at time zone 'Africa/Khartoum')
                                at time zone 'Africa/Khartoum')),
         s.otp_daily_budget
    from public.security_settings s
   where (select private.has_permission('settings'));
$$;
revoke execute on function public.otp_budget_today() from public, anon;
grant execute on function public.otp_budget_today() to authenticated;
