import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { type NextRequest } from "next/server";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import {
  WEBCHAT_CSRF_COOKIE,
  WEBCHAT_SESSION_COOKIE,
  digestWebchat,
  mensagemWebchatSchema,
  originDaRequisicao,
} from "@/lib/webchat/seguranca";
import type { MensagemWebchat } from "@/lib/webchat/types";
import { createAdminClient } from "@/lib/supabase/admin";

type ClienteRpc = {
  rpc: (
    name: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};
async function sessao() {
  const store = await cookies();
  return {
    session: store.get(WEBCHAT_SESSION_COOKIE)?.value,
    csrf: store.get(WEBCHAT_CSRF_COOKIE)?.value,
  };
}

async function pertenceAoLink(admin: ClienteRpc, request: NextRequest,
  sessionDigest: string, origin: string): Promise<boolean> {
  const publicId = request.headers.get("x-webchat-public-id");
  if (!publicId) return true; // Portal de handoff não tem ID público.
  const { data, error } = await admin.rpc("fn_webchat_sessao_visitante", {
    p_session_digest: sessionDigest, p_origin: origin,
  });
  const found = data as { ok?: boolean; public_id?: string } | null;
  return !error && found?.ok === true && found.public_id === publicId;
}

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const { session } = await sessao();
  if (!session)
    return fail("unauthenticated", "Sessão de atendimento ausente.", 401, { requestId });
  const origin = originDaRequisicao(request) ?? new URL(request.url).origin;
  const admin = createAdminClient() as unknown as ClienteRpc;
  const sessionDigest = digestWebchat(session);
  if (!(await pertenceAoLink(admin, request, sessionDigest, origin)))
    return fail("unauthenticated", "Sessão de outro atendimento.", 401, { requestId });
  const { data, error } = await admin.rpc("fn_ler_mensagens_webchat_visitante", {
    p_session_digest: sessionDigest,
    p_origin: origin,
  });
  if (error)
    return fail("internal_error", "Não foi possível carregar as mensagens.", 500, { requestId });
  if (!Array.isArray(data)) return fail("unauthenticated", "Sessão expirada.", 401, { requestId });
  return ok(data as MensagemWebchat[], { requestId });
}
export async function POST(request: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const origin = originDaRequisicao(request);
  const { session, csrf } = await sessao();
  const csrfHeader = request.headers.get("x-webchat-csrf");
  if (!origin || !session || !csrf || !csrfHeader || csrfHeader !== csrf)
    return fail("forbidden", "Sessão de atendimento inválida.", 403, { requestId });
  const parsed = mensagemWebchatSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return fail("validation_error", "Mensagem inválida.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors,
    });
  const sessionDigest = digestWebchat(session);
  const limite = await checkRateLimit(`webchat:message:${sessionDigest.slice(0, 16)}`, 30, 60);
  if (!limite.allowed)
    return fail("rate_limited", "Muitas mensagens; tente novamente em instantes.", 429, {
      requestId,
    });
  const admin = createAdminClient() as unknown as ClienteRpc;
  if (!(await pertenceAoLink(admin, request, sessionDigest, origin)))
    return fail("unauthenticated", "Sessão de outro atendimento.", 401, { requestId });
  const { data, error } = await admin.rpc("fn_registrar_mensagem_webchat_visitante", {
    p_session_digest: sessionDigest,
    p_csrf_digest: digestWebchat(csrf),
    p_origin: origin,
    p_body: parsed.data.body,
    p_idempotency_key: parsed.data.idempotency_key,
  });
  const resultado = data as { ok?: boolean; message?: MensagemWebchat } | null;
  if (error)
    return fail("internal_error", "Não foi possível enviar a mensagem.", 500, { requestId });
  if (!resultado?.ok || !resultado.message)
    return fail("unauthenticated", "Sessão expirada.", 401, { requestId });
  return ok(resultado.message, { requestId, status: 201 });
}
