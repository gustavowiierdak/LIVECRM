import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { fail } from "@/lib/api/wrappers";
import { createAdminClient } from "@/lib/supabase/admin";
import { WEBCHAT_SESSION_COOKIE, digestWebchat, origemDeLeituraWebchat } from "@/lib/webchat/seguranca";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = randomUUID();
  const parsed = z.uuid().safeParse((await context.params).id);
  if (!parsed.success) return fail("validation_error", "Mensagem inválida.", 422, { requestId });
  const session = (await cookies()).get(WEBCHAT_SESSION_COOKIE)?.value;
  if (!session) return fail("unauthenticated", "Sessão ausente.", 401, { requestId });
  const digest = digestWebchat(session);
  const admin = createAdminClient();
  const { data: valid, error: sessionError } = await admin.rpc("fn_webchat_sessao_visitante", {
    p_session_digest: digest, p_origin: origemDeLeituraWebchat(request),
  });
  const scope = valid as { ok?: boolean; public_id?: string } | null;
  if (sessionError || !scope?.ok) return fail("unauthenticated", "Sessão expirada.", 401, { requestId });
  const publicId = request.headers.get("x-webchat-public-id");
  if (publicId && scope.public_id !== publicId)
    return fail("unauthenticated", "Sessão de outro atendimento.", 401, { requestId });
  const { data: visitor } = await admin.from("webchat_visitor_sessions")
    .select("id,organization_id,source_conversation_id")
    .eq("session_digest", digest).maybeSingle();
  if (!visitor) return fail("unauthenticated", "Sessão expirada.", 401, { requestId });
  const { data: message } = await admin.from("messages")
    .select("media_storage_path,type")
    .eq("organization_id", visitor.organization_id)
    .eq("conversation_id", visitor.source_conversation_id)
    .eq("id", parsed.data)
    .in("type", ["image", "audio"])
    .maybeSingle();
  const { data: webMessage } = await admin.from("webchat_messages")
    .select("id")
    .eq("organization_id", visitor.organization_id)
    .eq("visitor_session_id", visitor.id)
    .eq("id", parsed.data)
    .maybeSingle();
  if (!webMessage || !message?.media_storage_path)
    return fail("not_found", "Anexo não encontrado.", 404, { requestId });
  const expectedPrefix = `${visitor.organization_id}/${visitor.source_conversation_id}/webchat-`;
  if (!message.media_storage_path.startsWith(expectedPrefix))
    return fail("not_found", "Anexo não encontrado.", 404, { requestId });
  const { data: signed, error } = await admin.storage.from("whatsapp-media")
    .createSignedUrl(message.media_storage_path, 300);
  if (error || !signed?.signedUrl)
    return fail("internal_error", "Anexo indisponível.", 500, { requestId });
  const response = NextResponse.redirect(signed.signedUrl, 302);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Request-Id", requestId);
  return response;
}
