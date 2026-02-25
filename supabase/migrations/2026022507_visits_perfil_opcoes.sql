alter table public.visits
  add column if not exists perfil_visita_opcoes text;

create or replace function public.normalize_visits_text()
returns trigger
language plpgsql
as $$
begin
  new.assigned_to_name = public.normalize_upper(new.assigned_to_name);
  new.perfil_visita = public.normalize_upper(new.perfil_visita);
  new.perfil_visita_opcoes = public.normalize_upper(new.perfil_visita_opcoes);
  new.no_visit_reason = public.normalize_upper(new.no_visit_reason);
  return new;
end;
$$;

update public.visits
set perfil_visita_opcoes = public.normalize_upper(perfil_visita)
where perfil_visita_opcoes is null
  and perfil_visita is not null;
