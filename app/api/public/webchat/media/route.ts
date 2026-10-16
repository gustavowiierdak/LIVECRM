import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { processarEntradaWebchat } from "@/lib/webchat/entrada-agente";
import { WEBCHAT_MAX_MEDIA_BYTES, validarMidiaWebchat } from "@/lib/webchat/media";
import { WEBCHAT_CSRF_COOKIE, WEBCHAT_SESSION_COOKIE, digestWebchat, originDaRequisicao } from "@/lib/webchat/seguranca";
import type { MensagemWebchat } from "@/lib/webchat/types";

export const dynamic = "force-dynamic";

type Scope = { organization_id: string; conversation_id: string; visitor_session_id: string; public_id: string };
type Registration = { ok?: boolean; reason?: string; new_message?: boolean; message?: MensagemWebchat };

export async function POST(request: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const origin = originDaRequisicao(request);
  const store = await cookies();
  const session = store.get(WEBCHAT_SESSION_COOKIE)?.value;
  const csrf = store.get(WEBCHAT_CSRF_COOKIE)?.value;
  const csrfHeader = request.headers.get("x-webchat-csrf");
  if (!origin || !session || !csrf || csrfHeader !== csrf)
    return fail("forbidden", "Sessão de atendimento inválida.", 403, { requestId });

  const sessionDigest = digestWebchat(session);
  const limit = await checkRateLimit(`webchat:media:${sessionDigest.slice(0, 16)}`, 8, 60);
  if (!limit.allowed) return fail("rate_limited", "Muitos anexos; tente novamente em instantes.", 429, { requestId });

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > WEBCHAT_MAX_MEDIA_BYTES + 1_048_576)
    return fail("payload_too_large", "Anexo acima de 10 MB.", 413, { requestId });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const key = z.uuid().safeParse(form?.get("idempotency_key"));
  if (!(file instanceof File) || !key.success)
    return fail("validation_error", "Anexo inválido.", 422, { requestId });
  if (file.size === 0 || file.size > WEBCHAT_MAX_MEDIA_BYTES)
    return fail("payload_too_large", "Anexo vazio ou acima de 10 MB.", 413, { requestId });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const media = validarMidiaWebchat(file.type, bytes);
  if (!media) return fail("unsupported_media_type", "Envie uma imagem ou áudio válido (até 10 MB).", 415, { requestId });

  const admin = createAdminClient();
  const { data: scope, error: scopeError } = await admin.rpc("fn_webchat_alvo_anexo", {
    p_session_digest: sessionDigest, p_csrf_digest: digestWebchat(csrf), p_origin: origin,
  });
  if (scopeError) return fail("internal_error", "Não foi possível validar o atendimento.", 500, { requestId });
  const target = scope as Scope | null;
  if (!target?.organization_id || !target.conversation_id || !target.visitor_session_id)
    return fail("unauthenticated", "Atendimento encerrado ou sessão expirada.", 401, { requestId });
  const publicId = request.headers.get("x-webchat-public-id");
  if (publicId && publicId !== target.public_id)
    return fail("unauthenticated", "Sessão de outro atendimento.", 401, { requestId });

  const { data: existing } = await admin.from("webchat_messages")
    .select("id,direction,body,created_at,metadata")
    .eq("organization_id", target.organization_id)
    .eq("visitor_session_id", target.visitor_session_id)
    .eq("direction", "visitor")
    .eq("idempotency_key", key.data)
    .maybeSingle();
  if (existing) return ok({ id: existing.id, direction: existing.direction,
    body: existing.body, created_at: existing.created_at,
    type: (existing.metadata as { webchat_media?: { kind?: string } } | null)?.webchat_media?.kind ?? "text" },
    { requestId, status: 201 });

  const path = `${target.organization_id}/${target.conversation_id}/webchat-${randomUUID()}.${media.ext}`;
  const { error: uploadError } = await admin.storage.from("whatsapp-media")
    .upload(path, bytes, { contentType: media.mime, upsert: false });
  if (uploadError) return fail("internal_error", "Não foi possível guardar o anexo.", 500, { requestId });

  const { data: registered, error: registerError } = await admin.rpc("fn_registrar_anexo_webchat_visitante", {
    p_session_digest: sessionDigest, p_csrf_digest: digestWebchat(csrf), p_origin: origin,
    p_storage_path: path, p_mime: media.mime, p_kind: media.kind,
    p_size_bytes: bytes.length, p_idempotency_key: key.data,
  });
  const result = registered as Registration | null;
  if (registerError || !result?.ok || !result.message || !result.new_message) {
    await admin.storage.from("whatsapp-media").remove([path]);
    if (result?.ok && result.message) return ok(result.message, { requestId, status: 201 });
    return fail(result?.reason === "conversation_closed" ? "conflict" : "internal_error",
      result?.reason === "conversation_closed" ? "Este atendimento foi encerrado." : "Não foi possível enviar o anexo.",
      result?.reason === "conversation_closed" ? 409 : 500, { requestId });
  }
  void audit({ action: "webchat.visitor_media_sent", organizationId: target.organization_id,
    resourceType: "conversation", resourceId: target.conversation_id, requestId,
    metadata: { message_id: result.message.id, media_kind: media.kind } });
  await processarEntradaWebchat(admin, { organizationId: target.organization_id,
    conversationId: target.conversation_id, messageId: result.message.id, requestId },
  { despacharAgente: false });
  return ok(result.message, { requestId, status: 201 });
}
