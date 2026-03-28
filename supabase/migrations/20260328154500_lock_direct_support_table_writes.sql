revoke insert, update, delete
on table public.support_tickets
from anon, authenticated;

revoke insert, update, delete
on table public.support_ticket_messages
from anon, authenticated;
