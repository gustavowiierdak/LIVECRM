import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { novaCredencialOpaca, setorWebchatSchema } from "@/lib/webchat/seguranca";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({ sector: setorWebchatSchema });
const conversationIdSchema = z.string().uuid();
type ClienteRpc = {
  rpc: (
    name: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

/** Entrega um código de uso único ao contato por um canal já autorizado pelo operador. */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "webchat_handoff" });
  if (!authz.ok) return authz.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("validation_error", "Setor inválido.", 422, { requestId });
  const { id } = await context.params;
  const conversationId = conversationIdSchema.safeParse(id);
  if (!conversationId.success)
    return fail("validation_error", "Conversa inválida.", 422, { requestId });
  const validatedConversationId = conversationId.data;
  const token = novaCredencialOpaca();
  const admin = createAdminClient() as unknown as ClienteRpc;
  const { data, error } = await admin.rpc("fn_emitir_webchat_handoff", {
    p_organization_id: authz.org.orgId,
    p_source_conversation_id: conversationId.data,
    p_sector: parsed.data.sector,
    p_token_digest: token.digest,
    p_issued_by: authz.user.id,
  });
  const resultado = data as {
    ok?: boolean;
    reason?: string;
    handoff_id?: string;
    expires_at?: string;
  } | null;
  if (error)
    return fail("internal_error", "Não foi possível criar o acesso de atendimento.", 500, {
      requestId,
    });
  if (!resultado?.ok)
    return fail(
      resultado?.reason === "conversation_not_found" ? "not_found" : "forbidden",
      "O atendimento web está desativado ou a conversa não foi encontrada.",
      resultado?.reason === "conversation_not_found" ? 404 : 403,
      { requestId },
    );
  void audit({
    action: "webchat.handoff_issued",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "conversation",
    resourceId: validatedConversationId,
    requestId,
    metadata: { sector: parsed.data.sector, handoff_id: resultado.handoff_id },
  });
  // O token só existe nesta resposta: o banco guarda apenas seu digest SHA-256.
  return ok(
    { handoff_token: token.raw, expires_at: resultado.expires_at, sector: parsed.data.sector },
    { requestId, status: 201 },
  );
}
