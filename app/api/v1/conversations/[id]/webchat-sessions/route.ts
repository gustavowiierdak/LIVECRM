import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SessaoOperadorWebchat } from "@/lib/webchat/types";

type ClienteRpc = {
  rpc: (
    name: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};
const conversationIdSchema = z.string().uuid();

/** A lista de sessões é exclusiva da inbox autenticada; visitante nunca é operador. */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "webchat_sessions" });
  if (!authz.ok) return authz.response;
  const { id } = await context.params;
  const conversationId = conversationIdSchema.safeParse(id);
  if (!conversationId.success)
    return fail("validation_error", "Conversa inválida.", 422, { requestId });
  const admin = createAdminClient() as unknown as ClienteRpc;
  const { data, error } = await admin.rpc("fn_listar_sessoes_webchat_operador", {
    p_organization_id: authz.org.orgId,
    p_source_conversation_id: conversationId.data,
  });
  if (error)
    return fail("internal_error", "Não foi possível carregar as sessões de atendimento.", 500, {
      requestId,
    });
  return ok((Array.isArray(data) ? data : []) as SessaoOperadorWebchat[], { requestId });
}
