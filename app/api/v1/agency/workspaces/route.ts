import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { erroDaAgencia } from "@/lib/agency/erros";
import { createChildSchema } from "@/lib/agency/preset";
import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/v1/agency/workspaces
 * Filhos da organização ativa. Dentro de um filho a lista é vazia: irmão não
 * aparece aqui.
 */
export async function GET() {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "organization" });
  if (!authz.ok) return authz.response;

  const admin = createAdminClient();
  const { data: self, error: selfError } = await admin
    .from("organizations")
    .select("parent_organization_id")
    .eq("id", authz.org.orgId)
    .maybeSingle();
  if (selfError) {
    return fail("internal_error", "Não foi possível ler a organização.", 500, { requestId });
  }
  if (self?.parent_organization_id) {
    return ok({ is_agency: false, workspaces: [] }, { requestId });
  }

  const { data, error } = await admin
    .from("organizations")
    .select("id, slug, display_name, status, created_at, parent_organization_id")
    .eq("parent_organization_id", authz.org.orgId)
    .order("display_name", { ascending: true });
  if (error) {
    return fail("internal_error", "Não foi possível listar os clientes.", 500, { requestId });
  }

  return ok({ is_agency: true, workspaces: data ?? [] }, { requestId });
}

/**
 * POST /api/v1/agency/workspaces
 * Cria um filho da organização ativa. O pai é o cookie, nunca o body.
 */
export async function POST(req: NextRequest) {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "organization" });
  if (!authz.ok) return authz.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("validation_failed", "JSON inválido.", 400, { requestId });
  }
  const parsed = createChildSchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_failed", "Informe nome e identificador válidos.", 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const admin = createAdminClient();
  const { data: self, error: selfError } = await admin
    .from("organizations")
    .select("parent_organization_id, status")
    .eq("id", authz.org.orgId)
    .maybeSingle();
  if (selfError || !self || self.status !== "active") {
    return fail("internal_error", "Não foi possível ler a organização.", 500, { requestId });
  }
  if (self.parent_organization_id) {
    return fail(
      "invalid_state",
      "Crie o próximo cliente a partir da organização da agência.",
      422,
      { requestId },
    );
  }

  const { data, error } = await admin.rpc("fn_agency_create_child", {
    p_actor: authz.user.id,
    p_parent: authz.org.orgId,
    p_display_name: parsed.data.display_name,
    p_slug: parsed.data.slug,
  });
  if (error) {
    const mapped = erroDaAgencia(error);
    return fail(mapped.code, mapped.message, mapped.status, { requestId });
  }

  const created = data as {
    id: string;
    slug: string;
    display_name: string;
    parent_organization_id: string;
  };
  await audit({
    action: "agency.workspace_created",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "organization",
    resourceId: created.id,
    requestId,
    bypassedRls: true,
    metadata: {
      child_organization_id: created.id,
      slug: created.slug,
    },
  });

  return ok(created, { status: 201, requestId });
}
