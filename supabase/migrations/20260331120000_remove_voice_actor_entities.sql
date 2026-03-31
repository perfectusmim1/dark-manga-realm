begin;

delete from public.comment_reports
where comment_entity_type = 'voice_actor';

drop function if exists public.increment_voice_actor_likes(uuid);
drop function if exists public.decrement_voice_actor_likes(uuid);

drop table if exists public.character_voice_actors cascade;
drop table if exists public.voice_actor_tags cascade;
drop table if exists public.voice_actor_reactions cascade;
drop table if exists public.voice_actor_comment_likes cascade;
drop table if exists public.voice_actor_comments cascade;
drop table if exists public.voice_actor_likes cascade;
drop table if exists public.voice_actors cascade;

commit;
