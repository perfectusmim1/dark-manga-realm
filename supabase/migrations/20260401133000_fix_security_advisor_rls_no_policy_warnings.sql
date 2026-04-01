drop policy if exists internal_worker_secrets_no_client_access
on public.internal_worker_secrets;

create policy internal_worker_secrets_no_client_access
on public.internal_worker_secrets
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists worker_metric_rollups_hourly_no_client_access
on public.worker_metric_rollups_hourly;

create policy worker_metric_rollups_hourly_no_client_access
on public.worker_metric_rollups_hourly
as restrictive
for all
to anon, authenticated
using (false)
with check (false);
