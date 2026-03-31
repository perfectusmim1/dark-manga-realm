create table if not exists public.worker_metric_rollups_hourly (
  bucket_start timestamptz not null,
  service text not null,
  event_name text not null,
  source_name text not null default '',
  operation_name text not null default '',
  source_host text not null default '',
  purpose text not null default '',
  entity_type text not null default '',
  variant text not null default '',
  status_bucket text not null default '',
  request_count bigint not null default 0,
  error_count bigint not null default 0,
  bytes_total bigint not null default 0,
  duration_total_ms bigint not null default 0,
  last_seen_at timestamptz not null default timezone('utc', now()),
  constraint worker_metric_rollups_hourly_pkey primary key (
    bucket_start,
    service,
    event_name,
    source_name,
    operation_name,
    source_host,
    purpose,
    entity_type,
    variant,
    status_bucket
  )
);

create index if not exists worker_metric_rollups_hourly_bucket_start_idx
  on public.worker_metric_rollups_hourly (bucket_start desc);

create index if not exists worker_metric_rollups_hourly_service_bucket_idx
  on public.worker_metric_rollups_hourly (service, bucket_start desc);

alter table public.worker_metric_rollups_hourly enable row level security;

create or replace function public.record_worker_metric(
  p_bucket_start timestamptz,
  p_service text,
  p_event_name text,
  p_source_name text default '',
  p_operation_name text default '',
  p_source_host text default '',
  p_purpose text default '',
  p_entity_type text default '',
  p_variant text default '',
  p_status_bucket text default '',
  p_request_count integer default 1,
  p_error_count integer default 0,
  p_bytes_total bigint default 0,
  p_duration_total_ms bigint default 0,
  p_last_seen_at timestamptz default timezone('utc', now())
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.worker_metric_rollups_hourly (
    bucket_start,
    service,
    event_name,
    source_name,
    operation_name,
    source_host,
    purpose,
    entity_type,
    variant,
    status_bucket,
    request_count,
    error_count,
    bytes_total,
    duration_total_ms,
    last_seen_at
  )
  values (
    date_trunc('hour', coalesce(p_bucket_start, timezone('utc', now()))),
    coalesce(trim(p_service), ''),
    coalesce(trim(p_event_name), ''),
    coalesce(trim(p_source_name), ''),
    coalesce(trim(p_operation_name), ''),
    coalesce(trim(p_source_host), ''),
    coalesce(trim(p_purpose), ''),
    coalesce(trim(p_entity_type), ''),
    coalesce(trim(p_variant), ''),
    coalesce(trim(p_status_bucket), ''),
    greatest(coalesce(p_request_count, 0), 0),
    greatest(coalesce(p_error_count, 0), 0),
    greatest(coalesce(p_bytes_total, 0), 0),
    greatest(coalesce(p_duration_total_ms, 0), 0),
    coalesce(p_last_seen_at, timezone('utc', now()))
  )
  on conflict (
    bucket_start,
    service,
    event_name,
    source_name,
    operation_name,
    source_host,
    purpose,
    entity_type,
    variant,
    status_bucket
  )
  do update
  set request_count = public.worker_metric_rollups_hourly.request_count + excluded.request_count,
      error_count = public.worker_metric_rollups_hourly.error_count + excluded.error_count,
      bytes_total = public.worker_metric_rollups_hourly.bytes_total + excluded.bytes_total,
      duration_total_ms = public.worker_metric_rollups_hourly.duration_total_ms + excluded.duration_total_ms,
      last_seen_at = greatest(public.worker_metric_rollups_hourly.last_seen_at, excluded.last_seen_at);
end;
$$;

revoke all on function public.record_worker_metric(
  timestamptz,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  integer,
  bigint,
  bigint,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.record_worker_metric(
  timestamptz,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  integer,
  bigint,
  bigint,
  timestamptz
) to service_role;
