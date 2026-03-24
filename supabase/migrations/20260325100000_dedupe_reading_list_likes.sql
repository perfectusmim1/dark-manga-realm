delete from public.reading_list_likes a
using public.reading_list_likes b
where a.id < b.id
  and a.list_id = b.list_id
  and a.user_id = b.user_id;

create unique index if not exists reading_list_likes_list_user_unique
on public.reading_list_likes (list_id, user_id);
