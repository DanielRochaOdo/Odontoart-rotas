alter table if exists public.agenda
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists geocode_source text,
  add column if not exists geocode_updated_at timestamptz;

create index if not exists agenda_lat_lng_idx on public.agenda(latitude, longitude);
create index if not exists agenda_city_uf_idx on public.agenda(cidade, uf);

