alter table public.chapter_automations
  drop constraint if exists chapter_automations_source_check;

alter table public.chapter_automations
  add constraint chapter_automations_source_check
  check (source in ('hayalistic', 'webtoonhatti', 'siyahmelek'));
