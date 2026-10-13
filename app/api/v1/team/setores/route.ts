import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { listarSetores } from "@/lib/routing/setores";

export async function GET() {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId });
  if (!authz.ok) return authz.response;
  try {
    return ok(await listarSetores(await createClient(), authz.org.orgId), { requestId });
  } catch {
    return fail("internal_error", "Não foi possível carregar os setores.", 500, { requestId });
  }
}

const entrada = z.discriminatedUnion("action", [
  z.object({ action: z.literal("criar_padrao") }),
  z.object({
    action: z.literal("salvar_membros"),
    setor_id: z.uuid(),
    user_ids: z.array(z.uuid()).max(500),
  }),
]);

export async function POST(req: Request) {
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const requestId = randomUUID();
  const parsed = entrada.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return fail("validation_failed", "Confira o setor e os atendentes.", 422, { requestId });
  const authz = await requireRole("manager", { requestId });
  if (!authz.ok) return authz.response;
  const db = await createClient();
  const org = authz.org.orgId;
  const input = parsed.data;
  const { error } =
    input.action === "criar_padrao"
      ? await db.rpc("fn_atendimento_criar_setores_padrao", { p_org: org })
      : await db.rpc("fn_atendimento_salvar_membros", {
          p_org: org,
          p_setor: input.setor_id,
          p_users: input.user_ids,
        });
  if (error)
    return fail(
      "unprocessable_entity",
      "Não foi possível salvar. Confira se as pessoas são atendentes ativos desta organização.",
      422,
      { requestId },
    );
  await audit({
    action: "atendimento.setores_configurados",
    actorUserId: authz.user.id,
    organizationId: org,
    resourceType: "organization",
    resourceId: authz.org.orgId,
    requestId,
    metadata: input,
  });
  return ok(await listarSetores(db, org), { requestId });
}
