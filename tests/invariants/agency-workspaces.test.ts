import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Agência v0 — dois filhos do mesmo pai.
 *
 * Quem só pertence ao filho A não lê contato, negócio, conversa, agente,
 * event_log nem compromisso do filho B. Quem só pertence ao pai (sem ser
 * admin copiado para o filho) também não lê. O admin do pai é membro dos
 * dois filhos e, por isso, a RLS deixa as duas linhas visíveis: o recorte
 * da tela é o cookie, não um alargamento de fn_user_org_ids().
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — run this suite via `pnpm test:db`");
}
const containerName: string = container;

const PARENT = "cccccccc-0000-4000-8000-000000000010";
const ADMIN = "cccccccc-1111-4000-8000-000000000010";
const VIEWER = "cccccccc-1111-4000-8000-000000000011";
const USER_A = "cccccccc-1111-4000-8000-0000000000a1";
const USER_B = "cccccccc-1111-4000-8000-0000000000b1";

function sql(script: string): string {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      containerName,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-tA",
      "-f",
      "-",
    ],
    { input: script, encoding: "utf8" },
  ).trim();
}

function countAs(userId: string, countQuery: string): number {
  const out = sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
    ${countQuery}
  `);
  const last = out.split("\n").at(-1);
  if (last === undefined || !/^\d+$/.test(last)) throw new Error(`unexpected psql output: ${out}`);
  return Number(last);
}

let childA = "";
let childB = "";

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${ADMIN}', 'agency-admin@invariant.test'),
      ('${VIEWER}', 'agency-viewer@invariant.test'),
      ('${USER_A}', 'agency-a@invariant.test'),
      ('${USER_B}', 'agency-b@invariant.test')
    on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${PARENT}', 'agencia-pai', 'Agência Pai', 'Agência Pai')
    on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${ADMIN}', '${PARENT}', 'admin', now())
    on conflict (user_id, organization_id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${VIEWER}', '${PARENT}', 'viewer', now())
    on conflict (user_id, organization_id) do nothing;
  `);

  const ensure = (slug: string, name: string) => {
    const existing = sql(`select id from public.organizations where slug = '${slug}'`);
    if (existing) return existing;
    const created = sql(
      `select public.fn_agency_create_child('${ADMIN}', '${PARENT}', '${name}', '${slug}')->>'id'`,
    );
    if (!/^[0-9a-f-]{36}$/.test(created)) throw new Error(`create child failed: ${created}`);
    return created;
  };
  childA = ensure("agencia-cliente-a", "Cliente A");
  childB = ensure("agencia-cliente-b", "Cliente B");

  sql(`
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${USER_A}', '${childA}', 'agent', now())
    on conflict (user_id, organization_id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${USER_B}', '${childB}', 'agent', now())
    on conflict (user_id, organization_id) do nothing;
  `);
});

const SNAPSHOT = `{
  "pipeline": {
    "name": "Atendimento",
    "slug": "atendimento",
    "stages": [
      {"name":"Novo","slug":"novo","position":1000,"is_won":false,"is_lost":false},
      {"name":"Qualificado","slug":"qualificado","position":2000,"is_won":false,"is_lost":false},
      {"name":"Agendado","slug":"agendado","position":3000,"is_won":false,"is_lost":false},
      {"name":"Ganho","slug":"ganho","position":4000,"is_won":true,"is_lost":false},
      {"name":"Perdido","slug":"perdido","position":5000,"is_won":false,"is_lost":true}
    ]
  },
  "agent": {"name":"Atendimento","system_prompt":"Qualifica e oferece horários. Não invente preço."},
  "event_type": {"name":"Encontro","slug":"encontro","duration_minutes":30,"category":"reuniao"}
}`;

describe("criação e modelo", () => {
  it("criar filho não abre sessão de canal", () => {
    const n = sql(
      `select count(*) from public.channel_sessions where organization_id in ('${childA}', '${childB}')`,
    );
    expect(Number(n)).toBe(0);
  });

  it("quem não é admin do pai não cria filho", () => {
    const out = sql(`
      do $$
      begin
        perform public.fn_agency_create_child('${VIEWER}', '${PARENT}', 'Intruso', 'agencia-intruso');
        raise exception 'should_have_failed';
      exception
        when insufficient_privilege then
          if sqlerrm not like '%agency_forbidden%' then raise; end if;
      end $$;
      select 1;
    `);
    expect(out.split("\n").at(-1)).toBe("1");
  });

  it("filho não vira pai", () => {
    const out = sql(`
      do $$
      begin
        perform public.fn_agency_create_child('${ADMIN}', '${childA}', 'Neto', 'agencia-neto');
        raise exception 'should_have_failed';
      exception
        when invalid_parameter_value then
          if sqlerrm not like '%agency_parent_invalid%' then raise; end if;
      end $$;
      select 1;
    `);
    expect(out.split("\n").at(-1)).toBe("1");
  });

  it("insert direto de neto também é recusado", () => {
    const out = sql(`
      do $$
      begin
        insert into public.organizations (slug, legal_name, display_name, parent_organization_id)
          values ('agencia-neto-direto', 'Neto', 'Neto', '${childA}');
        raise exception 'should_have_failed';
      exception
        when check_violation then
          if sqlerrm not like '%agency_nesting_forbidden%' then raise; end if;
      end $$;
      select 1;
    `);
    expect(out.split("\n").at(-1)).toBe("1");
  });

  it("anon não executa as funções", () => {
    const out = sql(`
      do $$
      begin
        set local role anon;
        perform public.fn_agency_create_child('${ADMIN}', '${PARENT}', 'X', 'agencia-anon');
        raise exception 'should_have_failed';
      exception
        when insufficient_privilege then null;
      end $$;
      select 1;
    `);
    expect(out.split("\n").at(-1)).toBe("1");
  });

  it("o modelo entra no filho A e não no B, e a segunda aplicação não duplica", () => {
    sql(`select public.fn_agency_apply_snapshot('${ADMIN}', '${childA}', '${SNAPSHOT}'::jsonb)`);
    sql(`select public.fn_agency_apply_snapshot('${ADMIN}', '${childA}', '${SNAPSHOT}'::jsonb)`);

    const stagesA = sql(`
      select count(*) from public.crm_stages s
      join public.crm_pipelines p on p.id = s.pipeline_id
      where s.organization_id = '${childA}' and p.slug = 'atendimento'
    `);
    const stagesB = sql(`
      select count(*) from public.crm_stages s
      join public.crm_pipelines p on p.id = s.pipeline_id
      where s.organization_id = '${childB}' and p.slug = 'atendimento'
    `);
    const versoes = sql(`
      select count(*) from public.ai_agent_versions v
      join public.ai_agents a on a.id = v.agent_id
      where v.organization_id = '${childA}' and a.name = 'Atendimento'
    `);
    const status = sql(`
      select v.status || ':' || coalesce(a.published_version_id::text, 'null')
      from public.ai_agent_versions v
      join public.ai_agents a on a.id = v.agent_id
      where v.organization_id = '${childA}' and a.name = 'Atendimento'
    `);
    const tipo = sql(`
      select count(*) from public.calendar_event_types
      where organization_id = '${childA}' and slug = 'encontro' and duration_minutes = 30
    `);
    const tipoB = sql(`
      select count(*) from public.calendar_event_types
      where organization_id = '${childB}' and slug = 'encontro'
    `);
    const canais = sql(
      `select count(*) from public.channel_sessions where organization_id = '${childA}'`,
    );

    expect(Number(stagesA)).toBe(5);
    expect(Number(stagesB)).toBe(0);
    expect(Number(versoes)).toBe(1);
    expect(status).toBe("draft:null");
    expect(Number(tipo)).toBe(1);
    expect(Number(tipoB)).toBe(0);
    expect(Number(canais)).toBe(0);
  });
});

function seedPrivate(org: string, tag: string) {
  sql(`
    insert into public.channel_sessions (organization_id, waha_session_name, webhook_secret_encrypted)
      select '${org}', 'agency-${tag}', '\\x00'::bytea
      where not exists (
        select 1 from public.channel_sessions where organization_id = '${org}' and waha_session_name = 'agency-${tag}'
      );
    insert into public.contacts (organization_id, display_name)
      select '${org}', 'Contato ${tag}'
      where not exists (
        select 1 from public.contacts where organization_id = '${org}' and display_name = 'Contato ${tag}'
      );
    insert into public.conversations (organization_id, contact_id, channel_session_id)
      select c.organization_id, c.id, s.id
      from public.contacts c
      join public.channel_sessions s on s.organization_id = c.organization_id and s.waha_session_name = 'agency-${tag}'
      where c.organization_id = '${org}' and c.display_name = 'Contato ${tag}'
        and not exists (
          select 1 from public.conversations cv where cv.organization_id = '${org}' and cv.contact_id = c.id
        );
    insert into public.crm_pipelines (organization_id, name, slug)
      select '${org}', 'Negocios ${tag}', 'negocios-${tag}'
      where not exists (
        select 1 from public.crm_pipelines where organization_id = '${org}' and slug = 'negocios-${tag}'
      );
    insert into public.crm_stages (organization_id, pipeline_id, name, slug, position)
      select p.organization_id, p.id, 'Aberto', 'aberto', 1000
      from public.crm_pipelines p
      where p.organization_id = '${org}' and p.slug = 'negocios-${tag}'
        and not exists (
          select 1 from public.crm_stages st where st.pipeline_id = p.id and st.slug = 'aberto'
        );
    insert into public.crm_leads (organization_id, pipeline_id, stage_id, title)
      select p.organization_id, p.id, st.id, 'Negocio ${tag}'
      from public.crm_pipelines p
      join public.crm_stages st on st.pipeline_id = p.id and st.slug = 'aberto'
      where p.organization_id = '${org}' and p.slug = 'negocios-${tag}'
        and not exists (
          select 1 from public.crm_leads l where l.organization_id = '${org}' and l.title = 'Negocio ${tag}'
        );
    insert into public.ai_agents (organization_id, name, system_prompt)
      select '${org}', 'Agente ${tag}', 'prompt privado ${tag}'
      where not exists (
        select 1 from public.ai_agents where organization_id = '${org}' and name = 'Agente ${tag}'
      );
    insert into public.event_log (organization_id, event_type, entity_kind)
      select '${org}', 'agency.probe', 'contact'
      where not exists (
        select 1 from public.event_log where organization_id = '${org}' and event_type = 'agency.probe'
      );
    insert into public.calendar_appointments (organization_id, title, starts_at, ends_at)
      select '${org}', 'Compromisso ${tag}', now(), now() + interval '30 minutes'
      where not exists (
        select 1 from public.calendar_appointments where organization_id = '${org}' and title = 'Compromisso ${tag}'
      );
  `);
}

describe("isolamento entre filhos", () => {
  beforeAll(() => {
    seedPrivate(childA, "a");
    seedPrivate(childB, "b");
  });

  const tabelas = [
    "contacts",
    "crm_leads",
    "conversations",
    "ai_agents",
    "event_log",
    "calendar_appointments",
  ] as const;

  it.each(tabelas)("o cliente A não vê %s do cliente B", (tabela) => {
    expect(
      countAs(USER_A, `select count(*) from public.${tabela} where organization_id = '${childB}'`),
    ).toBe(0);
    expect(
      countAs(USER_A, `select count(*) from public.${tabela} where organization_id = '${childA}'`),
    ).toBeGreaterThan(0);
  });

  it.each(tabelas)("o cliente B não vê %s do cliente A", (tabela) => {
    expect(
      countAs(USER_B, `select count(*) from public.${tabela} where organization_id = '${childA}'`),
    ).toBe(0);
    expect(
      countAs(USER_B, `select count(*) from public.${tabela} where organization_id = '${childB}'`),
    ).toBeGreaterThan(0);
  });

  it("o cliente A não vê a organização B", () => {
    expect(
      countAs(USER_A, `select count(*) from public.organizations where id = '${childB}'`),
    ).toBe(0);
    expect(
      countAs(USER_A, `select count(*) from public.organizations where id = '${childA}'`),
    ).toBe(1);
  });

  it("membro do pai que não foi copiado para o filho não lê os filhos", () => {
    for (const tabela of tabelas) {
      expect(
        countAs(
          VIEWER,
          `select count(*) from public.${tabela} where organization_id = '${childA}'`,
        ),
      ).toBe(0);
      expect(
        countAs(
          VIEWER,
          `select count(*) from public.${tabela} where organization_id = '${childB}'`,
        ),
      ).toBe(0);
    }
  });

  it("o admin do pai, membro dos dois filhos, enxerga os dois pelo vínculo", () => {
    expect(
      countAs(ADMIN, `select count(*) from public.contacts where organization_id = '${childA}'`),
    ).toBeGreaterThan(0);
    expect(
      countAs(ADMIN, `select count(*) from public.contacts where organization_id = '${childB}'`),
    ).toBeGreaterThan(0);
  });
});
