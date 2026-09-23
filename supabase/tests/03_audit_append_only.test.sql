-- The audit log is append-only for every role an application can use.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(9);

update app_settings set usd_sdg_rate = 1234 where id;
select ok((select count(*) from audit_logs where action = 'app_settings.update') >= 1,
          'rate change produced an audit row');
select is((select new_data ->> 'usd_sdg_rate' from audit_logs
            where action = 'app_settings.update' order by id desc limit 1),
          '1234.0000', 'audit row records the new rate');

-- postgres (migration owner, most privileged app-level role): blocked by triggers.
select throws_ok($$ update audit_logs set action = 'x' $$, '42501', 'AUDIT_LOG_APPEND_ONLY',
                 'postgres cannot UPDATE audit rows');
select throws_ok($$ delete from audit_logs $$, '42501', 'AUDIT_LOG_APPEND_ONLY',
                 'postgres cannot DELETE audit rows');
select throws_ok($$ truncate audit_logs $$, '42501', 'AUDIT_LOG_APPEND_ONLY',
                 'postgres cannot TRUNCATE the audit log');

-- service_role: no write privilege at all.
set local role service_role;
select throws_ok($$ update public.audit_logs set action = 'x' $$, '42501', null,
                 'service_role cannot UPDATE audit rows');
select throws_ok($$ delete from public.audit_logs $$, '42501', null,
                 'service_role cannot DELETE audit rows');
select throws_ok($$ insert into public.audit_logs (action, entity_type) values ('forged', 'x') $$,
                 '42501', null, 'service_role cannot INSERT forged audit rows');
reset role;

set local role authenticated;
select throws_ok($$ update public.audit_logs set action = 'x' $$, '42501', null,
                 'authenticated (any admin) cannot UPDATE audit rows');
reset role;

select * from finish();
rollback;
