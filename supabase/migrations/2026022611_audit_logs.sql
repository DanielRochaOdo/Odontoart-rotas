create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  action text not null,
  record_id text null,
  user_id uuid null references auth.users(id) on delete set null,
  user_name text null,
  old_data jsonb null,
  new_data jsonb null,
  created_at timestamptz default now()
);

create index if not exists audit_logs_created_idx on public.audit_logs(created_at desc);
create index if not exists audit_logs_table_idx on public.audit_logs(table_name);
create index if not exists audit_logs_user_idx on public.audit_logs(user_id);

alter table public.audit_logs enable row level security;

drop policy if exists "Supervisor can read audit logs" on public.audit_logs;
create policy "Supervisor can read audit logs" on public.audit_logs
  for select
  using (is_supervisor());

create or replace function public.log_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_user_name text;
  v_record_id text;
begin
  v_user_id := auth.uid();
  v_user_name := current_display_name();

  if (TG_OP = 'INSERT') then
    v_record_id := coalesce(new.id::text, null);
    insert into public.audit_logs (table_name, action, record_id, user_id, user_name, new_data)
    values (TG_TABLE_NAME, TG_OP, v_record_id, v_user_id, v_user_name, to_jsonb(new));
    return new;
  elsif (TG_OP = 'UPDATE') then
    v_record_id := coalesce(new.id::text, old.id::text, null);
    insert into public.audit_logs (table_name, action, record_id, user_id, user_name, old_data, new_data)
    values (TG_TABLE_NAME, TG_OP, v_record_id, v_user_id, v_user_name, to_jsonb(old), to_jsonb(new));
    return new;
  elsif (TG_OP = 'DELETE') then
    v_record_id := coalesce(old.id::text, null);
    insert into public.audit_logs (table_name, action, record_id, user_id, user_name, old_data)
    values (TG_TABLE_NAME, TG_OP, v_record_id, v_user_id, v_user_name, to_jsonb(old));
    return old;
  end if;

  return null;
exception
  when others then
    if (TG_OP = 'DELETE') then
      return old;
    end if;
    return new;
end;
$$;

drop trigger if exists audit_logs_agenda on public.agenda;
create trigger audit_logs_agenda
after insert or update or delete on public.agenda
for each row execute function public.log_audit_event();

drop trigger if exists audit_logs_clientes on public.clientes;
create trigger audit_logs_clientes
after insert or update or delete on public.clientes
for each row execute function public.log_audit_event();

drop trigger if exists audit_logs_visits on public.visits;
create trigger audit_logs_visits
after insert or update or delete on public.visits
for each row execute function public.log_audit_event();

drop trigger if exists audit_logs_routes on public.routes;
create trigger audit_logs_routes
after insert or update or delete on public.routes
for each row execute function public.log_audit_event();

drop trigger if exists audit_logs_route_stops on public.route_stops;
create trigger audit_logs_route_stops
after insert or update or delete on public.route_stops
for each row execute function public.log_audit_event();

drop trigger if exists audit_logs_profiles on public.profiles;
create trigger audit_logs_profiles
after insert or update or delete on public.profiles
for each row execute function public.log_audit_event();

drop trigger if exists audit_logs_aceite_digital on public.aceite_digital;
create trigger audit_logs_aceite_digital
after insert or update or delete on public.aceite_digital
for each row execute function public.log_audit_event();

-- Optional: log agenda header mappings
-- drop trigger if exists audit_logs_agenda_headers_map on public.agenda_headers_map;
-- create trigger audit_logs_agenda_headers_map
-- after insert or update or delete on public.agenda_headers_map
-- for each row execute function public.log_audit_event();
