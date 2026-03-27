insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'manga-artwork',
  'manga-artwork',
  true,
  10485760,
  array['image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can view manga artwork" on storage.objects;
create policy "Public can view manga artwork"
on storage.objects
for select
to public
using (bucket_id = 'manga-artwork');

drop policy if exists "Admins and moderators can manage manga artwork" on storage.objects;
create policy "Admins and moderators can manage manga artwork"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'manga-artwork'
  and public.check_user_role((select auth.uid())::text, array['admin', 'moderator'])
)
with check (
  bucket_id = 'manga-artwork'
  and public.check_user_role((select auth.uid())::text, array['admin', 'moderator'])
);
