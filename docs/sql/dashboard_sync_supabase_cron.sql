-- Prereq: run in the Dashboard project database as a privileged role.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Optional: keep CRON secret in Vault and compose header server-side.
-- select vault.create_secret('REPLACE_WITH_STRONG_SECRET', 'CRON_SECRET', 'sync dashboard cron token');

-- Replace placeholders:
-- 1) <project-ref> with your Supabase project ref
-- 2) <cron-secret> with CRON_SECRET value (or switch to Vault variant below)
select cron.schedule(
  'sync-dashboard-incremental-every-5m',
  '*/5 * * * *',
  $$
  select
    net.http_post(
      url := 'https://<project-ref>.supabase.co/functions/v1/sync-dashboard-incremental',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer <cron-secret>'
      ),
      body := '{}'::jsonb
    );
  $$
);

-- If using Vault, replace the schedule body with:
-- select cron.schedule(
--   'sync-dashboard-incremental-every-5m',
--   '*/5 * * * *',
--   $$
--   with cron_secret as (
--     select decrypted_secret as value
--     from vault.decrypted_secrets
--     where name = 'CRON_SECRET'
--     limit 1
--   )
--   select net.http_post(
--     url := 'https://<project-ref>.supabase.co/functions/v1/sync-dashboard-incremental',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer ' || (select value from cron_secret)
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );

-- Disable cron:
-- select cron.unschedule('sync-dashboard-incremental-every-5m');
