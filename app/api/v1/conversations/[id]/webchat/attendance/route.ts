import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { enriquecerMensagensWebchat } from "@/lib/webchat/enriquecer-mensagens";
import type { AtendimentoOperadorWebchat, MensagemWebchat, SessaoOperadorWebchat } from "@/lib/webchat/types";

/** Um único round-trip para abrir o fio; os RPCs mantêm o escopo de org/conversa/sessão. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "webchat_messages" });
  if (!authz.ok) return authz.response;
  const { id } = await context.params;
  const sessionId = request.nextUrl.searchParams.get("visitor_session_id");
  if (!z.uuid().safeParse(id).success || (sessionId !== null && !z.uuid().safeParse(sessionId).success)) {
    return fail("validation_error", "Conversa ou sessão inválida.", 422, { requestId });
  }
  const scoped = await createClient();
  const visible = await scoped.from("conversations").select("id")
    .eq("organization_id", authz.org.orgId).eq("id", id).maybeSingle();
  if (visible.error) return fail("internal_error", "Não foi possível consultar a conversa.", 500, { requestId });
  if (!visible.data) return fail("not_found", "Conversa não encontrada.", 404, { requestId });
  const admin = createAdminClient();
  const scope = { p_organization_id: authz.org.orgId, p_source_conversation_id: id };
  const sessionsResult = await admin.rpc("fn_listar_sessoes_webchat_operador", scope);
  if (sessionsResult.error) return fail("internal_error", "Não foi possível carregar as sessões de atendimento.", 500, { requestId });
  const sessions = (Array.isArray(sessionsResult.data) ? sessionsResult.data : []) as SessaoOperadorWebchat[];
  const selected = sessionId
    ? sessions.find((session) => session.id === sessionId)
    : (sessions.find((session) => session.active) ?? sessions[0]);
  if (sessionId && !selected) return fail("not_found", "Sessão de visitante não encontrada.", 404, { requestId });
  let messages: MensagemWebchat[] = [];
  if (selected) {
    const result = await admin.rpc("fn_ler_mensagens_webchat_operador", { ...scope, p_visitor_session_id: selected.id });
    if (result.error) return fail("internal_error", "Não foi possível carregar o atendimento web.", 500, { requestId });
    messages = await enriquecerMensagensWebchat(admin, authz.org.orgId, selected.id,
      (Array.isArray(result.data) ? result.data : []) as MensagemWebchat[]);
  }
  return ok<AtendimentoOperadorWebchat>({ sessions, selected_session_id: selected?.id ?? "", messages }, {
    requestId, headers: { "Cache-Control": "private, no-store" },
  });
}
