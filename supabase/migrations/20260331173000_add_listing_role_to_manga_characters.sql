alter table public.manga_characters
  add column if not exists listing_role text;

alter table public.manga_characters
  drop constraint if exists manga_characters_listing_role_check;

alter table public.manga_characters
  add constraint manga_characters_listing_role_check
  check (listing_role is null or listing_role in ('main', 'supporting', 'minor'));

update public.manga_characters as mc
set listing_role = (
  case
    when lower(coalesce(ch.details -> 'extra' ->> 'characterRoleType', '')) in ('main', 'supporting', 'minor')
      then lower(ch.details -> 'extra' ->> 'characterRoleType')
    when lower(coalesce(ch.details ->> 'role', '')) like '%main%'
      or lower(coalesce(ch.details ->> 'role', '')) like '%ana karakter%'
      then 'main'
    when lower(coalesce(ch.details ->> 'role', '')) like '%support%'
      or lower(coalesce(ch.details ->> 'role', '')) like '%secondary%'
      or lower(coalesce(ch.details ->> 'role', '')) like '%yan karakter%'
      then 'supporting'
    when lower(coalesce(ch.details ->> 'role', '')) like '%minor%'
      or lower(coalesce(ch.details ->> 'role', '')) like '%other%'
      or lower(coalesce(ch.details ->> 'role', '')) like '%diğer%'
      or lower(coalesce(ch.details ->> 'role', '')) like '%background%'
      then 'minor'
    else null
  end
)
from public.characters as ch
where ch.id = mc.character_id
  and mc.listing_role is null;

create index if not exists idx_manga_characters_manga_role
  on public.manga_characters (manga_id, listing_role, character_id);
