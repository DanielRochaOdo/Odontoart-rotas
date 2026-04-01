create extension if not exists unaccent;

create or replace function public.normalize_search_text(input_text text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(
      lower(unaccent(trim(coalesce(input_text, '')))),
      '\s+',
      ' ',
      'g'
    ),
    ''
  );
$$;

create or replace function public.agenda_exact_match_ids(
  p_company_name text default null,
  p_company_code text default null
)
returns table(id uuid)
language plpgsql
stable
as $$
declare
  normalized_name text := public.normalize_search_text(p_company_name);
  normalized_code text := public.normalize_search_text(p_company_code);
begin
  if normalized_name is null and normalized_code is null then
    return;
  end if;

  return query
  select a.id
  from public.agenda a
  where (normalized_name is null or public.normalize_search_text(a.empresa) = normalized_name)
    and (normalized_code is null or public.normalize_search_text(a.cod_1) = normalized_code);
end;
$$;
