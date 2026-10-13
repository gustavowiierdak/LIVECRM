import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";

const entrada = z.object({ setor_id: z.uuid(), reason: z.string().trim().max(500).optional() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;
  const parsed = entrada.safeParse(await req.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success)
    return fail("validation_failed", "Escolha um setor válido.", 422, { requestId });
  const db = await createClient();
  const { error } = await db.rpc("fn_atendimento_transferir_setor", {
    p_org: authz.org.orgId,
    p_conversa: id,
    p_setor: parsed.data.setor_id,
    p_motivo: parsed.data.reason,
  });
  if (error)
    return fail(
      "unprocessable_entity",
      "Não foi possível transferir. Confira seu acesso e se o atendimento ainda está aberto.",
      422,
      { requestId },
    );
  await audit({
    action: "conversation.transferred_to_sector",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "conversation",
    resourceId: id,
    requestId,
    metadata: parsed.data,
  });
  return ok({ id, atendimento_setor_id: parsed.data.setor_id }, { requestId });
}
