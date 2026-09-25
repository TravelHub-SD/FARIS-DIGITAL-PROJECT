-- WhatsApp outbox: no content stored, bounded retries, replay-safe webhook
-- statuses, cost per message, staff-only actions.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(54);

-- message_logs holds references and delivery metadata, never content.
select columns_are('public', 'message_logs', array[
  'id', 'phone_e164', 'user_id', 'message_type', 'template_name', 'order_id',
  'provider_message_id', 'status', 'error_code', 'attempts', 'next_retry_at',
  'created_at', 'updated_at', 'language', 'status_history_id', 'kyc_submission_id',
  'max_attempts', 'locked_until', 'sent_at', 'delivered_at', 'read_at', 'failed_at',
  'needs_attention', 'handled_by', 'handled_at', 'pricing_category', 'billable',
  'cost_usd', 'cost_source'],
  'message_logs has exactly the content-free column set');
select columns_are('private', 'message_events', array[
  'id', 'provider_message_id', 'status', 'occurred_at', 'error_code',
  'pricing_category', 'billable', 'received_at'],
  'message_events has no payload column');
select ok(not has_table_privilege('authenticated', 'private.message_events', 'select')
          and not has_table_privilege('anon', 'private.message_events', 'select'),
          'message_events is not readable by app roles');

insert into auth.users (id, instance_id, aud, role, email, phone, phone_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('10000000-0000-4000-8000-000000000051', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'msg-customer@test.local', '249911000051', now(),
   '{"signup_verified":"otp"}', '{}', now(), now()),
  ('10000000-0000-4000-8000-000000000052', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'msg-staff@test.local', '249911000052', now(),
   '{"signup_verified":"otp"}', '{}', now(), now());
insert into admins (user_id) values ('10000000-0000-4000-8000-000000000052');
insert into admin_permissions (admin_id, permission)
values ('10000000-0000-4000-8000-000000000052', 'orders');

update app_settings set usd_sdg_rate = 2600, kyc_threshold_usd = 100 where id;
delete from message_logs;

-- Enqueue: creating an order records its status and queues a notification
-- in the same transaction, with references only.
insert into orders (id, user_id, variant_id, quantity, idempotency_key, fulfillment_data)
values ('20000000-0000-4000-8000-000000000051', '10000000-0000-4000-8000-000000000051',
        '00000000-0000-4000-c000-000000000001', 1, gen_random_uuid(), '{"player_id":"123456"}');

create temp table n on commit drop as
  select id from message_logs where order_id = '20000000-0000-4000-8000-000000000051';
grant select on n to service_role, authenticated;

select is((select count(*)::int from n), 1, 'order creation queued one notification');
select is((select status::text || '/' || message_type::text || '/' || template_name
             from message_logs where id = (select id from n)),
          'queued/order_status/order_status_update', 'queued order_status_update row');
select ok((select status_history_id is not null from message_logs where id = (select id from n)),
          'notification references the status-history row (no text copied)');
select throws_ok(
  $$ update message_logs set error_code = 'Message failed: Your code is 123456' where id = (select id from n) $$,
  '23514', null, 'free-text error messages are refused (codes only)');

-- Claim → fail (retryable) four times: 1 / 5 / 30 min backoff, then failed.
set local role service_role;
select is((select count(*)::int from whatsapp_claim(10, 120)), 1, 'attempt 1 claimed');
select is((select count(*)::int from whatsapp_claim(10, 120)), 0,
          'a leased row is not claimed twice (no double send)');
select is(whatsapp_mark_failure((select id from n), 'http:503', true), 'retry', 'attempt 1 failed → retry');
select is((select next_retry_at - now() from message_logs where id = (select id from n)),
          interval '1 minute', 'retry after 1 minute');
select is((select count(*)::int from whatsapp_claim(10, 120)), 0, 'not due before the backoff');
reset role;
update message_logs set next_retry_at = now() where id = (select id from n);  -- time travel
set local role service_role;
select is((select attempts::int from whatsapp_claim(10, 120)), 2, 'attempt 2 claimed');
select is(whatsapp_mark_failure((select id from n), 'network:timeout', true), 'retry', 'attempt 2 failed → retry');
select is((select next_retry_at - now() from message_logs where id = (select id from n)),
          interval '5 minutes', 'retry after 5 minutes');
reset role;
update message_logs set next_retry_at = now() where id = (select id from n);
set local role service_role;
select is((select attempts::int from whatsapp_claim(10, 120)), 3, 'attempt 3 claimed');
select is(whatsapp_mark_failure((select id from n), 'http:503', true), 'retry', 'attempt 3 failed → retry');
select is((select next_retry_at - now() from message_logs where id = (select id from n)),
          interval '30 minutes', 'retry after 30 minutes');
reset role;
update message_logs set next_retry_at = now() where id = (select id from n);
set local role service_role;
select is((select attempts::int from whatsapp_claim(10, 120)), 4, 'attempt 4 claimed');
select is(whatsapp_mark_failure((select id from n), 'http:503', true), 'failed',
          'attempt 4 failed → failed for good (bounded)');
select is((select status::text || '/' || needs_attention::text || '/' || (failed_at is not null)::text
             from message_logs where id = (select id from n)),
          'failed/true/true', 'final failure is recorded and flagged for staff');
reset role;
update message_logs set next_retry_at = now() where id = (select id from n);
set local role service_role;
select is((select count(*)::int from whatsapp_claim(10, 120)), 0, 'no fifth attempt');
reset role;

-- A permanent error is not retried.
update orders set status = 'cancelled' where id = '20000000-0000-4000-8000-000000000051';
create temp table p on commit drop as
  select id from message_logs where order_id = '20000000-0000-4000-8000-000000000051'
     and id <> (select id from n) order by created_at limit 1;
grant select on p to service_role, authenticated;
set local role service_role;
select is((select count(*)::int from whatsapp_claim(10, 120)), 1, 'second notification claimed');
select is(whatsapp_mark_failure((select id from p), 'meta:131026', false), 'failed',
          'non-retryable error → failed at once');
select is((select attempts::int || '/' || needs_attention::text from message_logs where id = (select id from p)),
          '1/true', 'one attempt only, flagged for staff');

-- OTP: never queued for retry, never flagged individually, no code anywhere.
create temp table o on commit drop as
  select whatsapp_log_otp('+249911000051', '10000000-0000-4000-8000-000000000051', 'en') as id;
grant select on o to authenticated;
select is(whatsapp_mark_failure((select id from o), 'http:503', true), 'failed', 'OTP failure is not retried');
select is((select needs_attention from message_logs where id = (select id from o)), false,
          'OTP failure is not flagged individually (the customer asks again)');
select is((select count(*)::int from whatsapp_claim(10, 120)), 0, 'dispatcher never sends OTP rows');
reset role;

-- Webhook statuses: applied once; replay changes nothing.
update whatsapp_rates set usd_per_message = 0.0034 where category = 'utility';
update message_logs set status = 'queued', needs_attention = false, failed_at = null, error_code = null
 where id = (select id from p);
set local role service_role;
select lives_ok($$ select whatsapp_mark_sent((select id from p), 'wamid.TEST51', 'utility') $$, 'marked sent');
select is((select cost_usd::text || '/' || cost_source from message_logs where id = (select id from p)),
          '0.00340/estimate', 'estimated cost recorded at send from the rate card');
select is(whatsapp_apply_status('wamid.TEST51', 'delivered', now(), null, 'utility', false), 'applied',
          'delivered applied');
select is(whatsapp_apply_status('wamid.TEST51', 'delivered', now(), null, 'utility', true), 'duplicate',
          'replayed delivered (even with different billing) is a duplicate');
select is((select status::text || '/' || cost_usd::text || '/' || cost_source || '/' || billable::text
             from message_logs where id = (select id from p)),
          'delivered/0.00000/webhook/false', 'webhook billing fixed the cost once; replay did not change it');
select is(whatsapp_apply_status('wamid.TEST51', 'read', now(), null, null, null), 'applied', 'read applied');
select is(whatsapp_apply_status('wamid.TEST51', 'sent', now(), null, null, null), 'applied',
          'late "sent" event is recorded');
select is((select status::text from message_logs where id = (select id from p)), 'read',
          'late event does not move the status backwards');
select is(whatsapp_apply_status('wamid.UNKNOWN', 'delivered', now()), 'unknown_message',
          'status for a message we never sent is ignored');
select throws_ok($$ select whatsapp_apply_status('wamid.TEST51', 'deleted', now()) $$,
                 'P0001', 'INVALID_STATUS', 'unknown status value refused');
reset role;
select is((select count(*)::int from private.message_events where provider_message_id = 'wamid.TEST51'), 3,
          'one event row per (message, status)');

-- Failed webhook after "sent" flags the notification.
update message_logs set provider_message_id = 'wamid.TEST51B', status = 'sent' where id = (select id from n);
set local role service_role;
select is(whatsapp_apply_status('wamid.TEST51B', 'failed', now(), 'meta:131047', null, null), 'applied',
          'failed status applied');
reset role;
select is((select status::text || '/' || needs_attention::text || '/' || error_code
             from message_logs where id = (select id from n)),
          'failed/true/meta:131047', 'failed delivery flagged for staff with a code only');

-- Staff actions: orders permission only; audited.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000051","role":"authenticated"}';
select is((select count(*)::int from message_logs), 0, 'customer cannot read message_logs');
select throws_ok($$ select whatsapp_retry((select id from n)) $$, '42501', 'FORBIDDEN',
                 'customer cannot retry a message');
select throws_ok($$ select whatsapp_mark_handled((select id from n)) $$, '42501', 'FORBIDDEN',
                 'customer cannot mark a message handled');
select throws_ok($$ select * from whatsapp_spend(current_date, current_date) $$, '42501', 'FORBIDDEN',
                 'customer cannot read spend');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000052","role":"authenticated"}';
select throws_ok($$ select * from whatsapp_spend(current_date, current_date) $$, '42501', 'FORBIDDEN',
                 'orders staff without settings cannot read spend');
select lives_ok($$ select whatsapp_retry((select id from n)) $$, 'orders staff can retry a failed message');
select is((select status::text || '/' || max_attempts::text || '/' || needs_attention::text
             from message_logs where id = (select id from n)),
          'queued/5/false', 'retry grants exactly one more attempt');
select throws_ok($$ select whatsapp_retry((select id from o)) $$, 'P0001', 'MESSAGE_NOT_RETRYABLE',
                 'an OTP cannot be retried');
reset role;
select is((select count(*)::int from audit_logs where action = 'message_logs.retry'
            and entity_id = (select id from n)::text), 1, 'retry is audited');

-- A send that died on its last attempt (lease expired) becomes a visible failure.
update message_logs set attempts = max_attempts, locked_until = now() - interval '1 second',
       next_retry_at = now() - interval '2 minutes'
 where id = (select id from n);
set local role service_role;
select is((select count(*)::int from whatsapp_claim(10, 120)), 0, 'an exhausted row is not sent again');
reset role;
select is((select status::text || '/' || error_code || '/' || needs_attention::text
             from message_logs where id = (select id from n)),
          'failed/app:interrupted/true', 'interrupted last attempt is recorded and flagged, not left queued');

-- The scheduled tick does nothing without Vault secrets (no outbound call).
select is((select count(*)::int from net.http_request_queue), 0, 'no queued HTTP request before tick');
select lives_ok($$ select private.whatsapp_dispatch_tick() $$, 'tick runs');

select * from finish();
rollback;
