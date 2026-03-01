-- Saneia visitas legadas com perfil repetido e recalcula consolidado sem duplicacoes.

with normalized as (
  select
    v.id,
    (
      select string_agg(distinct perfil_item, ' • ' order by perfil_item)
      from (
        select nullif(
          trim(
            regexp_replace(
              public.normalize_upper(split_item),
              '\\s+',
              ' ',
              'g'
            )
          ),
          ''
        ) as perfil_item
        from regexp_split_to_table(
          replace(coalesce(v.perfil_visita, ''), 'â€¢', '•'),
          '\\s*[•,]\\s*'
        ) as split_item
      ) src
      where perfil_item is not null
    ) as perfil_clean
  from public.visits v
  where v.perfil_visita is not null
),
updates as (
  select
    id,
    perfil_clean,
    case
      when perfil_clean is null then null
      when perfil_clean ~ '\\d{1,2}:\\d{2}.*\\d{1,2}:\\d{2}' then perfil_clean
      when perfil_clean like '%CUSTOMIZADO%' then perfil_clean
      else null
    end as opcoes_clean
  from normalized
)
update public.visits v
set
  perfil_visita = u.perfil_clean,
  perfil_visita_opcoes = u.opcoes_clean
from updates u
where v.id = u.id
  and (
    coalesce(v.perfil_visita, '') <> coalesce(u.perfil_clean, '')
    or coalesce(v.perfil_visita_opcoes, '') <> coalesce(u.opcoes_clean, '')
  );

with agg as (
  select
    v.agenda_id,
    string_agg(distinct perfil_item, ' • ' order by perfil_item) as perfil_consolidado
  from public.visits v
  cross join lateral regexp_split_to_table(
    replace(
      coalesce(
        nullif(trim(v.perfil_visita), ''),
        nullif(trim(v.perfil_visita_opcoes), ''),
        ''
      ),
      'â€¢',
      '•'
    ),
    '\\s*[•,]\\s*'
  ) as split_item
  cross join lateral (
    select nullif(
      trim(
        regexp_replace(
          public.normalize_upper(split_item),
          '\\s+',
          ' ',
          'g'
        )
      ),
      ''
    ) as perfil_item
  ) normalized
  where v.agenda_id is not null
    and coalesce(v.perfil_visita, v.perfil_visita_opcoes) is not null
    and normalized.perfil_item is not null
  group by v.agenda_id
)
update public.agenda a
set perfil_visita = agg.perfil_consolidado
from agg
where a.id = agg.agenda_id
  and coalesce(a.perfil_visita, '') <> coalesce(agg.perfil_consolidado, '');

update public.clientes c
set perfil_visita = a.perfil_visita
from public.agenda a
where a.perfil_visita is not null
  and (
    (a.empresa is not null and c.empresa is not null and public.normalize_upper(c.empresa) = public.normalize_upper(a.empresa))
    or (a.nome_fantasia is not null and c.nome_fantasia is not null and public.normalize_upper(c.nome_fantasia) = public.normalize_upper(a.nome_fantasia))
  )
  and coalesce(c.perfil_visita, '') <> coalesce(a.perfil_visita, '');
