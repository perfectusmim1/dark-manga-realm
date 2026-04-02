revoke all on function public.admin_set_user_role(text, text) from public;
revoke all on function public.admin_set_user_role(text, text) from anon;
revoke all on function public.admin_set_user_role(text, text) from authenticated;
grant execute on function public.admin_set_user_role(text, text) to authenticated;
grant execute on function public.admin_set_user_role(text, text) to service_role;

revoke all on function public.get_admin_user_directory() from public;
revoke all on function public.get_admin_user_directory() from anon;
revoke all on function public.get_admin_user_directory() from authenticated;
grant execute on function public.get_admin_user_directory() to authenticated;
grant execute on function public.get_admin_user_directory() to service_role;
