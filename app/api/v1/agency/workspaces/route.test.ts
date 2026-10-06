import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { setActiveOrg } from "@/app/actions/shell/setActiveOrg";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/app/actions/shell/setActiveOrg", () => ({ setActiveOrg: vi.fn() }));

const ACTOR = "11111111-1111-4111-8111-111111111111";
const PARENT = "22222222-2222-4222-8222-222222222222";
const CHILD = "33333333-3333-4333-8333-333333333333";
const FOREIGN = "44444444-4444-4444-8444-444444444444";

const rpc = vi.fn();
const self = { parent_organization_id: null as string | null, status: "active" };
const child = {
  id: CHILD,
  slug: "cliente-a",
  display_name: "Cliente A",
  parent_organization_id: PARENT as string | null,
  status: "active",
};

function admin() {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return builder;
        },
        is: () => builder,
        not: () => builder,
        order: () => builder,
        maybeSingle: async () => {
          if (table === "user_organizations") return { data: { user_id: ACTOR }, error: null };
          if (filters.id === CHILD) return { data: child, error: null };
          return { data: self, error: null };
        },
        then(resolve: (value: { data: unknown[]; error: null }) => unknown) {
          return Promise.resolve({
            data: [
              {
                id: CHILD,
                slug: "cliente-a",
                display_name: "Cliente A",
                parent_organization_id: filters.parent_organization_id,
              },
            ],
            error: null,
          }).then(resolve);
        },
      };
      return builder;
    },
    rpc,
  };
}

beforeEach(() => {
  rpc.mockReset();
  self.parent_organization_id = null;
  self.status = "active";
  child.parent_organization_id = PARENT;
  child.status = "active";
  vi.mocked(createAdminClient).mockReturnValue(admin() as never);
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: ACTOR },
    org: { orgId: PARENT, name: "Agência", role: "admin" },
  } as never);
  vi.mocked(setActiveOrg).mockResolvedValue({ ok: true });
});

describe("workspaces da agência", () => {
  it("lista só os filhos da organização ativa", async () => {
    const { GET } = await import("./route");
    const res = await GET();
    const body = (await res.json()) as {
      data: { is_agency: boolean; workspaces: { parent_organization_id: string }[] };
    };
    expect(res.status).toBe(200);
    expect(body.data.is_agency).toBe(true);
    expect(body.data.workspaces[0]?.parent_organization_id).toBe(PARENT);
  });

  it("criar usa o pai da sessão, não um organization_id do body", async () => {
    rpc.mockResolvedValue({
      data: {
        id: CHILD,
        slug: "cliente-a",
        display_name: "Cliente A",
        parent_organization_id: PARENT,
      },
      error: null,
    });
    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost/api/v1/agency/workspaces", {
      method: "POST",
      body: JSON.stringify({
        display_name: "Cliente A",
        slug: "cliente-a",
        organization_id: FOREIGN,
        parent_organization_id: FOREIGN,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("fn_agency_create_child", {
      p_actor: ACTOR,
      p_parent: PARENT,
      p_display_name: "Cliente A",
      p_slug: "cliente-a",
    });
  });

  it("filho não cria neto", async () => {
    self.parent_organization_id = PARENT;
    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost/api/v1/agency/workspaces", {
      method: "POST",
      body: JSON.stringify({ display_name: "Neto", slug: "neto" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("entrar no filho que não é desta agência responde 404", async () => {
    child.parent_organization_id = null;
    const { POST } = await import("./[id]/enter/route");
    const res = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: CHILD }),
    });
    expect(res.status).toBe(404);
    expect(setActiveOrg).not.toHaveBeenCalled();
  });

  it("entrar chama a troca de organização do filho", async () => {
    const { POST } = await import("./[id]/enter/route");
    const res = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: CHILD }),
    });
    expect(res.status).toBe(200);
    expect(setActiveOrg).toHaveBeenCalledWith(CHILD);
  });

  it("modelo não roda em organização que não é filha", async () => {
    child.parent_organization_id = null;
    const { POST } = await import("./[id]/snapshot/route");
    const { PRESET_ATENDIMENTO_V0 } = await import("@/lib/agency/preset");
    const res = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify(PRESET_ATENDIMENTO_V0),
      }),
      { params: Promise.resolve({ id: CHILD }) },
    );
    expect(res.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });
});
