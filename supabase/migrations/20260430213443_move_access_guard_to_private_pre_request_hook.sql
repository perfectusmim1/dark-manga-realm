create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to anon, authenticated, authenticator, service_role;

create or replace function private.enforce_site_access_request()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v_claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  v_role text := coalesce(v_claims ->> 'role', 'anon');
  v_user_id text := nullif(v_claims ->> 'sub', '');
  v_forwarded_for text := coalesce(
    v_headers ->> 'x-forwarded-for',
    v_headers ->> 'cf-connecting-ip',
    v_headers ->> 'x-real-ip',
    ''
  );
  v_ip text := nullif(btrim(split_part(v_forwarded_for, ',', 1)), '');
  v_ip_hash text := case
    when v_ip is null then null
    else encode(extensions.digest(v_ip, 'sha256'), 'hex')
  end;
  v_device_hash text := nullif(btrim(coalesce(v_headers ->> 'x-device-hash', '')), '');
  v_ban_reason text;
begin
  if v_role = 'service_role' then
    return;
  end if;

  if v_ip_hash is not null and exists (
    select 1
    from public.banned_ip_hashes as banned_ips
    where banned_ips.ip_hash = v_ip_hash
  ) then
    raise sqlstate 'PGRST' using
      message = json_build_object(
        'code', 'SITE_ACCESS_BLOCKED',
        'message', 'Bu bağlantı için site erişimi engellendi.'
      )::text,
      detail = json_build_object('status', 403, 'headers', json_build_object())::text;
  end if;

  if v_device_hash is not null and exists (
    select 1
    from public.banned_device_hashes as banned_devices
    where banned_devices.device_hash = v_device_hash
  ) then
    raise sqlstate 'PGRST' using
      message = json_build_object(
        'code', 'SITE_ACCESS_BLOCKED',
        'message', 'Bu cihaz için site erişimi engellendi.'
      )::text,
      detail = json_build_object('status', 403, 'headers', json_build_object())::text;
  end if;

  if v_user_id is not null then
    select users_table.ban_reason
      into v_ban_reason
    from public.users as users_table
    where users_table.id = v_user_id
      and users_table.is_banned = true
    limit 1;

    if found then
      raise sqlstate 'PGRST' using
        message = json_build_object(
          'code', 'SITE_ACCESS_BLOCKED',
          'message', coalesce(v_ban_reason, 'Hesabınız banlandı.')
        )::text,
        detail = json_build_object('status', 403, 'headers', json_build_object())::text;
    end if;
  end if;
end;
$function$;

revoke all on function private.enforce_site_access_request() from public;
grant execute on function private.enforce_site_access_request() to anon, authenticated, authenticator, service_role;

revoke all on function public.enforce_site_access_request() from public;
revoke all on function public.enforce_site_access_request() from anon;
revoke all on function public.enforce_site_access_request() from authenticated;
revoke all on function public.enforce_site_access_request() from authenticator;
grant execute on function public.enforce_site_access_request() to service_role;

alter role authenticator set pgrst.db_pre_request = 'private.enforce_site_access_request';
notify pgrst, 'reload config';
