alter table public.chapter_automations
  add column if not exists last_test_status text not null default 'idle',
  add column if not exists last_tested_at timestamptz,
  add column if not exists last_test_error text,
  add column if not exists last_test_details jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chapter_automations_last_test_status_check'
  ) then
    alter table public.chapter_automations
      add constraint chapter_automations_last_test_status_check
      check (last_test_status in ('idle', 'running', 'success', 'error'));
  end if;
end $$;
