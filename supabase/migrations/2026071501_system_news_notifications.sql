create table if not exists public.system_news_reads (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null references public.system_news(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint system_news_reads_update_user_unique unique (update_id, user_id)
);

create index if not exists idx_system_news_reads_user_id on public.system_news_reads (user_id);
create index if not exists idx_system_news_reads_update_id on public.system_news_reads (update_id);
create index if not exists idx_system_news_reads_user_read_at on public.system_news_reads (user_id, read_at desc);

alter table public.system_news_reads enable row level security;

drop policy if exists "Users can view their own update reads" on public.system_news_reads;
create policy "Users can view their own update reads"
on public.system_news_reads
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can insert their own update reads" on public.system_news_reads;
create policy "Users can insert their own update reads"
on public.system_news_reads
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Users can update their own update reads" on public.system_news_reads;
create policy "Users can update their own update reads"
on public.system_news_reads
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users can delete their own update reads" on public.system_news_reads;
create policy "Users can delete their own update reads"
on public.system_news_reads
for delete
to authenticated
using (user_id = auth.uid());

create or replace function public.system_news_notifications_for_current_user(p_limit integer default 5)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_limit integer := greatest(1, least(coalesce(p_limit, 5), 5));
begin
  select p.role::text
    into v_role
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1;

  if auth.uid() is null or v_role is null then
    return jsonb_build_object('notifications', '[]'::jsonb, 'totalUnread', 0);
  end if;

  return jsonb_build_object(
    'notifications',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', n.id,
          'title', n.titulo,
          'descriptionPreview', left(regexp_replace(regexp_replace(n.descricao, '<[^>]+>', ' ', 'g'), '\s+', ' ', 'g'), 180),
          'type', n.tipo,
          'module', n.modulo,
          'publishedAt', n.data_publicacao,
          'isRead', exists (
            select 1
            from public.system_news_reads r
            where r.update_id = n.id
              and r.user_id = auth.uid()
          )
        )
        order by n.data_publicacao desc, n.created_at desc
      )
      from (
        select n.*
        from public.system_news n
        where n.ativo = true
          and n.data_publicacao <= now()
          and v_role = any (n.roles_permitidos)
          and not exists (
            select 1
            from public.system_news_reads r
            where r.update_id = n.id
              and r.user_id = auth.uid()
          )
        order by n.data_publicacao desc, n.created_at desc
        limit v_limit
      ) n
    ), '[]'::jsonb),
    'totalUnread',
    (
      select count(*)
      from public.system_news n
      where n.ativo = true
        and n.data_publicacao <= now()
        and v_role = any (n.roles_permitidos)
        and not exists (
          select 1
          from public.system_news_reads r
          where r.update_id = n.id
            and r.user_id = auth.uid()
        )
    )
  );
end;
$$;

create or replace function public.system_news_mark_as_read(p_update_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.system_news n
    join public.profiles p on p.user_id = auth.uid()
    where n.id = p_update_id
      and n.ativo = true
      and n.data_publicacao <= now()
      and p.role::text = any (n.roles_permitidos)
  ) then
    raise exception 'Notificacao nao autorizada.' using errcode = '42501';
  end if;

  insert into public.system_news_reads (update_id, user_id)
  values (p_update_id, auth.uid())
  on conflict (update_id, user_id) do update
    set read_at = now();

  return true;
end;
$$;

grant execute on function public.system_news_notifications_for_current_user(integer) to authenticated;
grant execute on function public.system_news_mark_as_read(uuid) to authenticated;
