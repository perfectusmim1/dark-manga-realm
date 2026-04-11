create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
    if coalesce(current_setting('toonparrot.clear_updated_at', true), 'off') = 'on' then
        new.updated_at = null;
    elsif coalesce(current_setting('toonparrot.preserve_updated_at', true), 'off') = 'on' then
        new.updated_at = old.updated_at;
    else
        new.updated_at = now();
    end if;

    return new;
end;
$function$;
