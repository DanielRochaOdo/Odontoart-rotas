create or replace function public.agenda_exact_match_ids(
  p_company_name text default null,
  p_company_code text default null
)
returns table(id uuid)
language plpgsql
stable
as $$
declare
  normalized_name_tokens text := public.normalize_search_text_tokens(p_company_name);
  normalized_code text := public.normalize_search_text(p_company_code);
begin
  if normalized_name_tokens is null and normalized_code is null then
    return;
  end if;

  return query
  with agenda_with_canonical as (
    select
      a.id,
      coalesce(canon.empresa, a.empresa) as empresa_ref,
      coalesce(canon.codigo, a.cod_1) as codigo_ref
    from public.agenda a
    left join lateral (
      select c.empresa, c.codigo
      from public.clientes c
      where (
        a.cod_1 is not null
        and c.codigo is not null
        and public.normalize_search_text(c.codigo) = public.normalize_search_text(a.cod_1)
      )
      or (
        (a.empresa is not null or a.nome_fantasia is not null)
        and public.normalize_search_text(coalesce(c.empresa, '')) = public.normalize_search_text(coalesce(a.empresa, ''))
        and public.normalize_search_text(coalesce(c.nome_fantasia, '')) = public.normalize_search_text(coalesce(a.nome_fantasia, ''))
      )
      order by
        case
          when a.cod_1 is not null
            and c.codigo is not null
            and public.normalize_search_text(c.codigo) = public.normalize_search_text(a.cod_1)
          then 0 else 1
        end,
        c.created_at desc nulls last
      limit 1
    ) canon on true
  )
  select awc.id
  from agenda_with_canonical awc
  where (
    normalized_name_tokens is null
    or position(
      ' ' || normalized_name_tokens || ' '
      in ' ' || coalesce(public.normalize_search_text_tokens(awc.empresa_ref), '') || ' '
    ) > 0
  )
    and (
      normalized_code is null
      or public.normalize_search_text(awc.codigo_ref) = normalized_code
    );
end;
$$;
