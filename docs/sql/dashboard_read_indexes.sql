-- Optional extra read indexes for dashboard project (run on DASHBOARD Supabase)

create index if not exists idx_dash_visits_cliente_id
  on public.dash_visits(cliente_id);

create index if not exists idx_dash_visits_completed_at
  on public.dash_visits(completed_at);

create index if not exists idx_dash_visits_no_visit_reason
  on public.dash_visits(no_visit_reason);

create index if not exists idx_dash_visits_visit_date_completed
  on public.dash_visits(visit_date, completed_at);

create index if not exists idx_dash_visits_visit_date_assigned
  on public.dash_visits(visit_date, assigned_to_user_id);

create index if not exists idx_dash_aceite_vendor_date
  on public.dash_aceite_digital(vendor_user_id, entry_date);

create index if not exists idx_dash_clientes_vendedor
  on public.dash_clientes(vendedor);

create index if not exists idx_dash_clientes_situacao
  on public.dash_clientes(situacao);

create index if not exists idx_dash_clientes_categoria
  on public.dash_clientes(categoria);

create index if not exists idx_dash_profiles_user_id
  on public.dash_profiles(user_id);
