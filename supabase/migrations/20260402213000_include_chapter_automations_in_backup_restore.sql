create or replace function public.restore_site_backup(
  p_manifest jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tables jsonb;
  v_table_rows jsonb;
  v_table_name text;
  v_upsert_tables text[] := array[
    'site_settings',
    'announcements',
    'tags',
    'authors',
    'artists',
    'characters',
    'mangas',
    'chapters',
    'chapter_automations'
  ];
  v_replace_tables text[] := array[
    'manga_characters',
    'manga_authors',
    'manga_artists',
    'manga_relations',
    'manga_tags',
    'character_tags',
    'author_tags',
    'artist_tags'
  ];
  v_restored_tables text[] := array[]::text[];
  v_table_regclass pg_catalog.regclass;
  v_pk_columns text[];
  v_conflict_columns text;
  v_insert_columns text;
  v_update_columns text;
begin
  if p_manifest is null or jsonb_typeof(p_manifest) <> 'object' then
    raise exception 'Manifest is required';
  end if;

  if coalesce((p_manifest ->> 'version')::integer, -1) <> 2 then
    raise exception 'Unsupported backup version: %', p_manifest ->> 'version';
  end if;

  v_tables := p_manifest -> 'tables';
  if v_tables is null or jsonb_typeof(v_tables) <> 'object' then
    raise exception 'Manifest tables payload is required';
  end if;

  foreach v_table_name in array (v_upsert_tables || v_replace_tables) loop
    if (v_tables ? v_table_name) and jsonb_typeof(v_tables -> v_table_name) <> 'array' then
      raise exception 'Table payload must be an array: %', v_table_name;
    end if;
  end loop;

  foreach v_table_name in array v_replace_tables loop
    if not (v_tables ? v_table_name) then
      continue;
    end if;

    v_table_rows := coalesce(v_tables -> v_table_name, '[]'::jsonb);
    execute format('delete from public.%I', v_table_name);

    if jsonb_array_length(v_table_rows) > 0 then
      execute format(
        'insert into public.%1$I select * from jsonb_populate_recordset(null::public.%1$I, $1)',
        v_table_name
      ) using v_table_rows;
    end if;

    v_restored_tables := array_append(v_restored_tables, v_table_name);
  end loop;

  foreach v_table_name in array v_upsert_tables loop
    if not (v_tables ? v_table_name) then
      continue;
    end if;

    v_table_rows := coalesce(v_tables -> v_table_name, '[]'::jsonb);
    v_table_regclass := pg_catalog.to_regclass(format('public.%I', v_table_name));

    if v_table_regclass is null then
      raise exception 'Backup restore target table not found: %', v_table_name;
    end if;

    select pg_catalog.array_agg(att.attname order by key.ord)
    into v_pk_columns
    from pg_catalog.pg_index idx
    join pg_catalog.pg_class cls on cls.oid = idx.indrelid
    join pg_catalog.pg_namespace ns on ns.oid = cls.relnamespace
    join lateral unnest(idx.indkey) with ordinality as key(attnum, ord) on true
    join pg_catalog.pg_attribute att on att.attrelid = cls.oid and att.attnum = key.attnum
    where ns.nspname = 'public'
      and cls.oid = v_table_regclass
      and idx.indisprimary;

    if coalesce(pg_catalog.array_length(v_pk_columns, 1), 0) = 0 then
      raise exception 'Backup restore requires a primary key on table: %', v_table_name;
    end if;

    select
      pg_catalog.string_agg(format('%I', att.attname), ', ' order by att.attnum),
      pg_catalog.string_agg(format('%1$I = excluded.%1$I', att.attname), ', ' order by att.attnum)
    into v_insert_columns, v_update_columns
    from pg_catalog.pg_attribute att
    where att.attrelid = v_table_regclass
      and att.attnum > 0
      and not att.attisdropped
      and att.attname <> all(v_pk_columns);

    select pg_catalog.string_agg(format('%I', pk.col), ', ' order by pk.ord)
    into v_conflict_columns
    from unnest(v_pk_columns) with ordinality as pk(col, ord);

    select pg_catalog.string_agg(format('%I', att.attname), ', ' order by att.attnum)
    into v_insert_columns
    from pg_catalog.pg_attribute att
    where att.attrelid = v_table_regclass
      and att.attnum > 0
      and not att.attisdropped;

    if jsonb_array_length(v_table_rows) > 0 then
      execute format(
        'insert into public.%1$I (%2$s)
         select %2$s
         from jsonb_populate_recordset(null::public.%1$I, $1)
         on conflict (%3$s) %4$s',
        v_table_name,
        v_insert_columns,
        v_conflict_columns,
        case
          when coalesce(v_update_columns, '') <> '' then 'do update set ' || v_update_columns
          else 'do nothing'
        end
      ) using v_table_rows;
    end if;

    v_restored_tables := array_append(v_restored_tables, v_table_name);
  end loop;

  return jsonb_build_object(
    'restoredAt', now(),
    'restoredTables', to_jsonb(v_restored_tables)
  );
end;
$$;

revoke all on function public.restore_site_backup(jsonb) from public;
revoke all on function public.restore_site_backup(jsonb) from anon;
revoke all on function public.restore_site_backup(jsonb) from authenticated;
grant execute on function public.restore_site_backup(jsonb) to service_role;
