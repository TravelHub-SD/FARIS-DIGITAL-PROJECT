-- Regression guards: every table has RLS, nothing internal is callable or
-- readable by API roles. A new migration that forgets any of this fails here.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(7);

select is_empty(
  $$ select n.nspname || '.' || c.relname
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'private') and c.relkind in ('r', 'p')
        and not c.relrowsecurity $$,
  'every table in public and private has RLS enabled');

select set_eq(
  $$ select p.proname::text from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and has_function_privilege('anon', p.oid, 'execute') $$,
  array['search_products', 'price_sdg', 'price_sdg_totals', 'product_comments'],
  'anon can execute exactly the public catalog functions (product_comments is definer: visible comments, first names only)');

select set_eq(
  $$ select p.proname::text from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and has_function_privilege('authenticated', p.oid, 'execute') $$,
  array['change_order_status', 'submit_kyc', 'kyc_open_document', 'review_kyc', 'kyc_mark_file_deleted',
        'search_products', 'price_sdg', 'price_sdg_totals', 'create_order', 'submit_receipt', 'review_receipt',
        'product_comments', 'set_customer_blocked', 'admin_orders', 'admin_comments',
        'whatsapp_mark_handled', 'whatsapp_retry', 'whatsapp_spend'],
  'authenticated can execute exactly the intended public RPCs');

select set_eq(
  $$ select p.proname::text from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and has_function_privilege('service_role', p.oid, 'execute')
        and not has_function_privilege('authenticated', p.oid, 'execute') $$,
  array['otp_issue', 'otp_verify', 'rate_limit_exceeded', 'rate_limit_record', 'rate_limit_clear',
        'auth_user_id_by_phone', 'auth_revoke_sessions',
        'whatsapp_claim', 'whatsapp_message_context', 'whatsapp_mark_sent', 'whatsapp_mark_failure',
        'whatsapp_log_otp', 'whatsapp_apply_status'],
  'OTP / session / WhatsApp dispatcher functions are server-only (service_role), never authenticated');

select set_eq(
  $$ select p.proname::text from pg_proc p
      where p.pronamespace = 'private'::regnamespace
        and has_function_privilege('supabase_auth_admin', p.oid, 'execute')
        and p.proname like 'auth_hook_%' $$,
  array['auth_hook_before_user_created', 'auth_hook_send_sms'],
  'GoTrue (supabase_auth_admin) can call exactly the two auth hooks');

select is_empty(
  $$ select c.relname from pg_class c
      where c.relnamespace = 'private'::regnamespace and c.relkind = 'r'
        and (has_table_privilege('anon', c.oid, 'select')
             or has_table_privilege('authenticated', c.oid, 'select')) $$,
  'private tables are not readable by anon/authenticated');

select is_empty(
  $$ select p.proname from pg_proc p
      where p.pronamespace = 'private'::regnamespace
        and has_function_privilege('authenticated', p.oid, 'execute')
        and p.proname not in ('is_admin', 'is_owner', 'has_permission',
                              'admin_assurance_ok', 'normalize_ar', 'valid_field_definitions',
                              'can_write_public_asset') $$,
  'only the authorization helpers in private are executable by authenticated');

select * from finish();
rollback;
