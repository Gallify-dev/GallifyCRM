import { randomUUID } from "node:crypto";
import { z } from "zod";

import { clienteDaAgencia } from "@/lib/agency/acesso";
import { erroDaAgencia } from "@/lib/agency/erros";
import { snapshotSchema } from "@/lib/agency/preset";
import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/v1/agency/workspaces/:id/snapshot
 * Copia funil, rascunho de agente e tipo de compromisso para o filho.
 * Não publica o agente e não abre canal.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "organization" });
  if (!authz.ok) return authz.response;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", "Cliente não encontrado.", 404, { requestId });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("validation_failed", "JSON inválido.", 400, { requestId });
  }
  const parsed = snapshotSchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_failed", "O modelo está incompleto.", 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const child = await clienteDaAgencia(authz.user.id, id);
  if (!child) return fail("not_found", "Cliente não encontrado.", 404, { requestId });

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("fn_agency_apply_snapshot", {
    p_actor: authz.user.id,
    p_child: child.id,
    p_snapshot: parsed.data,
  });
  if (error) {
    const mapped = erroDaAgencia(error);
    return fail(mapped.code, mapped.message, mapped.status, { requestId });
  }

  const applied = data as {
    pipeline_id: string;
    agent_id: string;
    agent_version_id: string;
    event_type_id: string;
  };
  await audit({
    action: "agency.snapshot_applied",
    actorUserId: authz.user.id,
    organizationId: child.id,
    resourceType: "organization",
    resourceId: child.id,
    requestId,
    bypassedRls: true,
    metadata: {
      parent_organization_id: child.parent_organization_id,
      pipeline_id: applied.pipeline_id,
      agent_id: applied.agent_id,
      agent_version_id: applied.agent_version_id,
      event_type_id: applied.event_type_id,
    },
  });

  return ok(applied, { requestId });
}
