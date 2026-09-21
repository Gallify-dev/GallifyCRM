import { randomUUID } from "node:crypto";
import { z } from "zod";

import { clienteDaAgencia } from "@/lib/agency/acesso";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { setActiveOrg } from "@/app/actions/shell/setActiveOrg";

/**
 * POST /api/v1/agency/workspaces/:id/enter
 * Entra no filho. O cookie só muda depois de o ator ser admin do pai daquela
 * linha e membro aceito do filho (setActiveOrg confere o vínculo de novo).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "organization" });
  if (!authz.ok) return authz.response;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", "Cliente não encontrado.", 404, { requestId });
  }

  const child = await clienteDaAgencia(authz.user.id, id);
  if (!child) return fail("not_found", "Cliente não encontrado.", 404, { requestId });

  const switched = await setActiveOrg(child.id);
  if (!switched.ok) {
    return fail("forbidden", "Não foi possível entrar neste cliente.", 403, { requestId });
  }

  return ok({ organization_id: child.id, display_name: child.display_name }, { requestId });
}
