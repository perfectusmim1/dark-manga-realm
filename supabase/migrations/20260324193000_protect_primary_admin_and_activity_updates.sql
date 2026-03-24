create or replace function public.enforce_primary_admin_guard()
returns trigger
language plpgsql
as $$
declare
    primary_admin_email constant text := 'caganherdil@gmail.com';
begin
    if tg_op = 'INSERT' then
        if new.role = 'admin' and lower(coalesce(new.email, '')) <> primary_admin_email then
            raise exception 'Only the primary admin account can hold admin role';
        end if;

        return new;
    end if;

    if tg_op = 'UPDATE' then
        if lower(coalesce(old.email, '')) = primary_admin_email then
            if lower(coalesce(new.email, '')) <> primary_admin_email or new.role <> 'admin' then
                raise exception 'Primary admin cannot be demoted, reassigned, or removed';
            end if;
        end if;

        if new.role = 'admin' and lower(coalesce(new.email, '')) <> primary_admin_email then
            raise exception 'Only the primary admin account can hold admin role';
        end if;

        return new;
    end if;

    if tg_op = 'DELETE' then
        if lower(coalesce(old.email, '')) = primary_admin_email then
            raise exception 'Primary admin cannot be deleted';
        end if;

        return old;
    end if;

    return coalesce(new, old);
end;
$$;

drop trigger if exists trg_enforce_primary_admin_guard on public.users;

create trigger trg_enforce_primary_admin_guard
before insert or update or delete
on public.users
for each row
execute function public.enforce_primary_admin_guard();

drop policy if exists "Users can update their own activity" on public.reading_activity_log;

create policy "Users can update their own activity"
on public.reading_activity_log
for update
using (
    (user_id = (auth.uid())::text)
    or (user_id = ((current_setting('request.jwt.claims', true))::json ->> 'sub'))
)
with check (
    (user_id = (auth.uid())::text)
    or (user_id = ((current_setting('request.jwt.claims', true))::json ->> 'sub'))
);
