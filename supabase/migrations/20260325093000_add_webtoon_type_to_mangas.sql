do $$
declare
  column_data_type text;
  column_udt_name text;
  check_constraint record;
begin
  select data_type, udt_name
  into column_data_type, column_udt_name
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'mangas'
    and column_name = 'type';

  if column_data_type is null then
    raise exception 'public.mangas.type kolonu bulunamadi';
  end if;

  if column_data_type = 'USER-DEFINED' then
    execute format(
      'alter type public.%I add value if not exists ''webtoon''',
      column_udt_name
    );
  end if;

  for check_constraint in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'mangas'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%type%'
      and (
        pg_get_constraintdef(c.oid) ilike '%manga%'
        or pg_get_constraintdef(c.oid) ilike '%manhwa%'
        or pg_get_constraintdef(c.oid) ilike '%manhua%'
      )
  loop
    execute format('alter table public.mangas drop constraint if exists %I', check_constraint.conname);
  end loop;

  if column_data_type <> 'USER-DEFINED' then
    alter table public.mangas
      alter column type type text;
  end if;

  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'mangas'
      and c.conname = 'mangas_type_check'
  ) then
    alter table public.mangas
      add constraint mangas_type_check
      check (type in ('manga', 'manhwa', 'manhua', 'webtoon'));
  end if;
end $$;
