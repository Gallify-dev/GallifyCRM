-- 0263 — agência: uma organização pai, N workspaces clientes, um modelo.
--
-- O pai é uma organização comum. O filho é outra organização, com
-- `parent_organization_id` apontando para o pai. Quem enxerga o filho é quem
-- tem linha em `user_organizations` — a mesma RLS de sempre. Ser membro do pai
-- NÃO inclui os filhos em `fn_user_org_ids()`.
--
-- Um nível só. Filho não vira pai. Criar filho não abre sessão de canal e não
-- cobra nada: o trigger que já existe semeia três tipos de agenda, e o modelo
-- abaixo acrescenta funil, rascunho de agente e um tipo de compromisso.
--
-- As duas funções são `security definer` e só o `service_role` executa. O
-- handler confere o ator no JWT e manda o id; o corpo confere de novo que esse
-- ator é admin aceito do pai.

alter table public.organizations
  add column if not exists parent_organization_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'organizations_parent_organization_id_fkey'
      and conrelid = 'public.organizations'::regclass
  ) then
    alter table public.organizations
      add constraint organizations_parent_organization_id_fkey
      foreign key (parent_organization_id)
      references public.organizations (id)
      on delete restrict;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'organizations_parent_not_self'
      and conrelid = 'public.organizations'::regclass
  ) then
    alter table public.organizations
      add constraint organizations_parent_not_self
      check (parent_organization_id is distinct from id);
  end if;
end
$$;

create index if not exists organizations_parent_idx
  on public.organizations (parent_organization_id)
  where parent_organization_id is not null;

comment on column public.organizations.parent_organization_id is
  'Pai desta organização, quando ela é um workspace cliente de uma agência. NULL = organização raiz. Um nível só: o pai também tem de ser raiz. Não alarga fn_user_org_ids().';

create or replace function public.fn_organizations_parent_um_nivel()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.parent_organization_id is null then
    return new;
  end if;
  if exists (
    select 1 from public.organizations p
    where p.id = new.parent_organization_id
      and p.parent_organization_id is not null
  ) then
    raise exception 'agency_nesting_forbidden' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.organizations c
    where c.parent_organization_id = new.id
  ) then
    raise exception 'agency_parent_has_children' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.fn_organizations_parent_um_nivel() from public, anon, authenticated;

drop trigger if exists trg_organizations_parent_um_nivel on public.organizations;
create trigger trg_organizations_parent_um_nivel
  before insert or update of parent_organization_id on public.organizations
  for each row
  execute function public.fn_organizations_parent_um_nivel();

create or replace function public.fn_agency_create_child(
  p_actor uuid,
  p_parent uuid,
  p_display_name text,
  p_slug text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org public.organizations%rowtype;
  v_name text := btrim(p_display_name);
  v_slug text := btrim(p_slug);
begin
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'invalid_display_name' using errcode = '22023';
  end if;
  if v_slug is null or v_slug !~ '^[a-z0-9-]{2,40}$' then
    raise exception 'invalid_slug' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.user_organizations
    where user_id = p_actor
      and organization_id = p_parent
      and role = 'admin'
      and revoked_at is null
      and accepted_at is not null
  ) then
    raise exception 'agency_forbidden' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.organizations
    where id = p_parent
      and status = 'active'
      and parent_organization_id is null
  ) then
    raise exception 'agency_parent_invalid' using errcode = '22023';
  end if;

  insert into public.organizations (
    slug, legal_name, display_name, status, created_by, parent_organization_id
  ) values (
    v_slug, v_name, v_name, 'active', p_actor, p_parent
  ) returning * into v_org;

  -- Todo admin aceito do pai entra no filho como admin. Quem só pertence a um
  -- filho não entra no irmão: esta cópia lê o pai, não os outros filhos.
  insert into public.user_organizations (
    organization_id, user_id, role, accepted_at, invited_by
  )
  select v_org.id, uo.user_id, 'admin', now(), p_actor
  from public.user_organizations uo
  where uo.organization_id = p_parent
    and uo.role = 'admin'
    and uo.revoked_at is null
    and uo.accepted_at is not null
  on conflict (user_id, organization_id) do nothing;

  return jsonb_build_object(
    'id', v_org.id,
    'slug', v_org.slug,
    'display_name', v_org.display_name,
    'parent_organization_id', v_org.parent_organization_id
  );
end;
$$;

revoke all on function public.fn_agency_create_child(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.fn_agency_create_child(uuid, uuid, text, text) to service_role;

create or replace function public.fn_agency_apply_snapshot(
  p_actor uuid,
  p_child uuid,
  p_snapshot jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parent uuid;
  v_pipe jsonb;
  v_agent jsonb;
  v_type jsonb;
  v_stages jsonb;
  v_pipe_name text;
  v_pipe_slug text;
  v_agent_name text;
  v_prompt text;
  v_type_name text;
  v_type_slug text;
  v_category text;
  v_duration int;
  v_pipe_id uuid;
  v_agent_id uuid;
  v_published uuid;
  v_version_id uuid;
  v_type_id uuid;
  v_version_number int;
  v_tem_funil_padrao boolean;
  v_tem_agente_padrao boolean;
  v_won int;
  v_lost int;
  v_stage jsonb;
  v_stage_row record;
  v_stage_name text;
  v_stage_slug text;
  v_stage_pos numeric;
  v_stage_won boolean;
  v_stage_lost boolean;
  v_ord int := 0;
begin
  select o.parent_organization_id into v_parent
  from public.organizations o
  where o.id = p_child
    and o.status = 'active'
    and o.parent_organization_id is not null;

  if v_parent is null then
    raise exception 'agency_child_invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.user_organizations
    where user_id = p_actor
      and organization_id = v_parent
      and role = 'admin'
      and revoked_at is null
      and accepted_at is not null
  ) then
    raise exception 'agency_forbidden' using errcode = '42501';
  end if;

  v_pipe := p_snapshot -> 'pipeline';
  v_agent := p_snapshot -> 'agent';
  v_type := p_snapshot -> 'event_type';
  if v_pipe is null or v_agent is null or v_type is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'invalid_snapshot' using errcode = '22023';
  end if;

  v_pipe_name := btrim(v_pipe ->> 'name');
  v_pipe_slug := btrim(v_pipe ->> 'slug');
  v_agent_name := btrim(v_agent ->> 'name');
  v_prompt := v_agent ->> 'system_prompt';
  v_type_name := btrim(v_type ->> 'name');
  v_type_slug := btrim(v_type ->> 'slug');
  v_category := coalesce(nullif(btrim(v_type ->> 'category'), ''), 'outro');
  v_stages := v_pipe -> 'stages';

  if v_pipe_name is null or char_length(v_pipe_name) < 2 or char_length(v_pipe_name) > 120
     or v_pipe_slug is null or v_pipe_slug !~ '^[a-z0-9_-]{2,40}$'
     or v_agent_name is null or char_length(v_agent_name) < 2 or char_length(v_agent_name) > 80
     or v_prompt is null or char_length(v_prompt) < 1 or char_length(v_prompt) > 20000
     or v_type_name is null or char_length(v_type_name) < 2 or char_length(v_type_name) > 120
     or v_type_slug is null or v_type_slug !~ '^[a-z0-9_-]{2,40}$'
     or v_category not in (
       'consulta', 'procedimento', 'retorno', 'visita', 'vistoria',
       'reuniao', 'call', 'orcamento', 'demonstracao', 'outro'
     )
     or jsonb_typeof(v_stages) <> 'array'
     or jsonb_array_length(v_stages) < 1
     or jsonb_array_length(v_stages) > 20
  then
    raise exception 'invalid_snapshot' using errcode = '22023';
  end if;

  begin
    v_duration := (v_type ->> 'duration_minutes')::int;
  exception when invalid_text_representation then
    raise exception 'invalid_snapshot' using errcode = '22023';
  end;
  if v_duration is null or v_duration < 5 or v_duration > 1440 then
    raise exception 'invalid_snapshot' using errcode = '22023';
  end if;

  select
    count(*) filter (where lower(coalesce(s.elem ->> 'is_won', 'false')) = 'true'),
    count(*) filter (where lower(coalesce(s.elem ->> 'is_lost', 'false')) = 'true')
  into v_won, v_lost
  from jsonb_array_elements(v_stages) as s(elem);
  if v_won > 1 or v_lost > 1 then
    raise exception 'invalid_snapshot' using errcode = '22023';
  end if;

  select exists (
    select 1 from public.crm_pipelines
    where organization_id = p_child and is_default and not is_archived
  ) into v_tem_funil_padrao;

  insert into public.crm_pipelines (organization_id, name, slug, is_default)
  values (p_child, v_pipe_name, v_pipe_slug, not v_tem_funil_padrao)
  on conflict (organization_id, slug) do update
    set name = excluded.name,
        updated_at = now()
  returning id into v_pipe_id;

  for v_stage_row in select value as elem from jsonb_array_elements(v_stages)
  loop
    v_stage := v_stage_row.elem;
    v_ord := v_ord + 1;
    v_stage_name := btrim(v_stage ->> 'name');
    v_stage_slug := btrim(v_stage ->> 'slug');
    if v_stage_name is null or char_length(v_stage_name) < 1 or char_length(v_stage_name) > 80
       or v_stage_slug is null or v_stage_slug !~ '^[a-z0-9_-]{2,40}$'
    then
      raise exception 'invalid_snapshot' using errcode = '22023';
    end if;
    if lower(coalesce(v_stage ->> 'is_won', 'false')) in ('true', 'false') then
      v_stage_won := lower(coalesce(v_stage ->> 'is_won', 'false')) = 'true';
    else
      raise exception 'invalid_snapshot' using errcode = '22023';
    end if;
    if lower(coalesce(v_stage ->> 'is_lost', 'false')) in ('true', 'false') then
      v_stage_lost := lower(coalesce(v_stage ->> 'is_lost', 'false')) = 'true';
    else
      raise exception 'invalid_snapshot' using errcode = '22023';
    end if;
    if v_stage_won and v_stage_lost then
      raise exception 'invalid_snapshot' using errcode = '22023';
    end if;
    begin
      v_stage_pos := coalesce((v_stage ->> 'position')::numeric, v_ord * 1000);
    exception when invalid_text_representation then
      raise exception 'invalid_snapshot' using errcode = '22023';
    end;

    insert into public.crm_stages (
      organization_id, pipeline_id, name, slug, position, is_won, is_lost
    ) values (
      p_child, v_pipe_id, v_stage_name, v_stage_slug, v_stage_pos, v_stage_won, v_stage_lost
    )
    on conflict (pipeline_id, slug) do update
      set name = excluded.name,
          position = excluded.position,
          is_won = excluded.is_won,
          is_lost = excluded.is_lost,
          updated_at = now();
  end loop;

  select exists (
    select 1 from public.ai_agents
    where organization_id = p_child and is_default and archived_at is null
  ) into v_tem_agente_padrao;

  insert into public.ai_agents (
    organization_id, name, system_prompt, created_by, is_default
  ) values (
    p_child, v_agent_name, v_prompt, p_actor, not v_tem_agente_padrao
  )
  on conflict (organization_id, name) do update
    set system_prompt = case
          when public.ai_agents.published_version_id is null then excluded.system_prompt
          else public.ai_agents.system_prompt
        end,
        updated_at = now()
  returning id, published_version_id into v_agent_id, v_published;

  -- Rascunho. Não publica e não exige número: publicar sem canal é recusado
  -- por fn_publish_ai_agent_version, e o motor só executa published_version_id.
  if not exists (
    select 1 from public.ai_agent_versions
    where organization_id = p_child
      and agent_id = v_agent_id
      and system_prompt = v_prompt
  ) then
    select coalesce(max(version_number), 0) + 1 into v_version_number
    from public.ai_agent_versions
    where agent_id = v_agent_id;

    insert into public.ai_agent_versions (
      organization_id, agent_id, version_number, system_prompt,
      provider, model, channel_session_id, status, created_by
    ) values (
      p_child, v_agent_id, v_version_number, v_prompt,
      'anthropic', 'claude-sonnet-4-6', null, 'draft', p_actor
    )
    returning id into v_version_id;
  else
    select id into v_version_id
    from public.ai_agent_versions
    where organization_id = p_child
      and agent_id = v_agent_id
      and system_prompt = v_prompt
    order by version_number desc
    limit 1;
  end if;

  insert into public.calendar_event_types (
    organization_id, name, slug, category, duration_minutes, position
  ) values (
    p_child, v_type_name, v_type_slug, v_category, v_duration, 4000
  )
  on conflict (organization_id, slug) do update
    set name = excluded.name,
        category = excluded.category,
        duration_minutes = excluded.duration_minutes,
        updated_at = now()
  returning id into v_type_id;

  return jsonb_build_object(
    'pipeline_id', v_pipe_id,
    'stage_count', v_ord,
    'agent_id', v_agent_id,
    'agent_version_id', v_version_id,
    'published_version_id', v_published,
    'event_type_id', v_type_id
  );
end;
$$;

revoke all on function public.fn_agency_apply_snapshot(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.fn_agency_apply_snapshot(uuid, uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
