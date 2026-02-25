-- Add visit generation tracking fields (idempotent)
alter table if exists public.agenda
  add column if not exists visit_generated_at timestamptz,
  add column if not exists visit_assigned_to text,
  add column if not exists visit_route_id uuid;

alter table if exists public.agenda
  add constraint agenda_visit_route_fk
  foreign key (visit_route_id)
  references public.routes(id)
  on delete set null;

create index if not exists agenda_visit_generated_at_idx on public.agenda(visit_generated_at);
create index if not exists agenda_visit_route_id_idx on public.agenda(visit_route_id);
