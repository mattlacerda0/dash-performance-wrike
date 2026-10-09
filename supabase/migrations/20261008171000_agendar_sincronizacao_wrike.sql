-- Antes de aplicar, salve no Vault o segredo `performance_wrike_sync_secret`.
-- Ele deve ter o mesmo valor de WRIKE_SYNC_SECRET das Edge Functions.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid)
from cron.job
where jobname = 'sincronizar-performance-wrike-15min';

select cron.schedule(
  'sincronizar-performance-wrike-15min',
  '*/15 * * * *',
  $cron$
    with segredo as (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'performance_wrike_sync_secret'
      limit 1
    )
    select net.http_post(
      url := 'https://rckpuebaiswrxzmywllv.supabase.co/functions/v1/sincronizar-wrike',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-wrike-sync-secret', segredo.decrypted_secret
      ),
      body := '{}'::jsonb
    )
    from segredo;
  $cron$
);
