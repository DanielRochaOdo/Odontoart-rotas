do $$
declare
  v_job_id bigint;
begin
  begin
    for v_job_id in
      select jobid
      from cron.job
      where jobname = 'kpi-sync-daily'
         or jobname = 'kpi_daily'
         or command ilike '%kpi-sync-daily%'
         or command ilike '%kpi_daily%'
    loop
      perform cron.unschedule(v_job_id);
    end loop;
  exception
    when undefined_table then
      null;
    when undefined_function then
      null;
    when invalid_schema_name then
      null;
    when insufficient_privilege then
      null;
  end;
end $$;
