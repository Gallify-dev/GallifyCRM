import { createAdminClient } from "@/lib/supabase/admin";

export interface ClienteDaAgencia {
  id: string;
  slug: string;
  display_name: string;
  parent_organization_id: string;
  status: string;
}

/**
 * O filho tem de existir, estar ativo e pendurado num pai cujo ator é admin
 * aceito. O id do filho vem do path; o pai sai da linha, nunca do body.
 */
export async function clienteDaAgencia(
  actorId: string,
  childId: string,
): Promise<ClienteDaAgencia | null> {
  const admin = createAdminClient();
  const { data: child, error } = await admin
    .from("organizations")
    .select("id, slug, display_name, parent_organization_id, status")
    .eq("id", childId)
    .maybeSingle();
  if (error || !child?.parent_organization_id || child.status !== "active") return null;

  const { data: membership, error: membErr } = await admin
    .from("user_organizations")
    .select("user_id")
    .eq("user_id", actorId)
    .eq("organization_id", child.parent_organization_id)
    .eq("role", "admin")
    .is("revoked_at", null)
    .not("accepted_at", "is", null)
    .maybeSingle();
  if (membErr || !membership) return null;

  return child as ClienteDaAgencia;
}
