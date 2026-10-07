import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { mensagemWebchatSchema } from "@/lib/webchat/seguranca";
import type { MensagemWebchat } from "@/lib/webchat/types";
import { createAdminClient } from "@/lib/supabase/admin";

const consultaSchema = z.string().uuid();
const envioSchema = mensagemWebchatSchema.extend({ visitor_session_id: z.string().uuid() });
const conversationIdSchema = z.string().uuid();
type ClienteRpc = {
  rpc: (
    name: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "webchat_messages" });
  if (!authz.ok) return authz.response;
  const visitorSessionId = consultaSchema.safeParse(
    new URL(request.url).searchParams.get("visitor_session_id"),
  );
  if (!visitorSessionId.success)
    return fail("validation_error", "Sessão de visitante inválida.", 422, { requestId });
  const { id } = await context.params;
  const conversationId = conversationIdSchema.safeParse(id);
  if (!conversationId.success)
    return fail("validation_error", "Conversa inválida.", 422, { requestId });
  const admin = createAdminClient() as unknown as ClienteRpc;
  const { data, error } = await admin.rpc("fn_ler_mensagens_webchat_operador", {
    p_organization_id: authz.org.orgId,
    p_source_conversation_id: conversationId.data,
    p_visitor_session_id: visitorSessionId.data,
  });
  if (error)
    return fail("internal_error", "Não foi possível carregar o atendimento web.", 500, {
      requestId,
    });
  return ok((Array.isArray(data) ? data : []) as MensagemWebchat[], { requestId });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "webchat_messages" });
  if (!authz.ok) return authz.response;
  const parsed = envioSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return fail("validation_error", "Mensagem inválida.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors,
    });
  const { id } = await context.params;
  const conversationId = conversationIdSchema.safeParse(id);
  if (!conversationId.success)
    return fail("validation_error", "Conversa inválida.", 422, { requestId });
  const validatedConversationId = conversationId.data;
  const admin = createAdminClient() as unknown as ClienteRpc;
  const { data, error } = await admin.rpc("fn_enviar_mensagem_webchat_operador", {
    p_organization_id: authz.org.orgId,
    p_source_conversation_id: conversationId.data,
    p_visitor_session_id: parsed.data.visitor_session_id,
    p_body: parsed.data.body,
    p_idempotency_key: parsed.data.idempotency_key,
    p_sent_by_user_id: authz.user.id,
  });
  const resultado = data as {
    ok?: boolean;
    reason?: "conversation_closed";
    message?: MensagemWebchat;
  } | null;
  if (error)
    return fail("internal_error", "Não foi possível responder pelo atendimento web.", 500, {
      requestId,
    });
  if (resultado?.reason === "conversation_closed")
    return fail("conflict", "Este atendimento foi encerrado.", 409, { requestId });
  if (!resultado?.ok || !resultado.message)
    return fail("not_found", "Sessão de visitante não encontrada ou expirada.", 404, { requestId });
  void audit({
    action: "webchat.operator_message_sent",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "conversation",
    resourceId: validatedConversationId,
    requestId,
    metadata: {
      visitor_session_id: parsed.data.visitor_session_id,
      message_id: resultado.message.id,
    },
  });
  return ok(resultado.message, { requestId, status: 201 });
}
