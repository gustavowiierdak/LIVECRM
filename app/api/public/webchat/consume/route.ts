import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import {
  WEBCHAT_CSRF_COOKIE,
  WEBCHAT_SESSION_COOKIE,
  digestWebchat,
  novaCredencialOpaca,
  opcoesCookieWebchat,
  originDaRequisicao,
} from "@/lib/webchat/seguranca";
import type { SessaoVisitanteWebchat } from "@/lib/webchat/types";
import { createAdminClient } from "@/lib/supabase/admin";

const corpoSchema = z.object({ token: z.string().min(32).max(256) });
type ClienteRpc = {
  rpc: (
    name: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

/** Consome o código entregue pelo atendente; token e identificação nunca entram na URL. */
export async function POST(request: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const origin = originDaRequisicao(request);
  if (!origin) return fail("forbidden", "Origem inválida.", 403, { requestId });
  const parsed = corpoSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return fail("validation_error", "Código de acesso inválido.", 422, { requestId });
  const tokenDigest = digestWebchat(parsed.data.token);
  const limite = await checkRateLimit(`webchat:consume:${tokenDigest.slice(0, 16)}`, 5, 60);
  if (!limite.allowed)
    return fail("rate_limited", "Tente novamente em instantes.", 429, { requestId });
  const session = novaCredencialOpaca();
  const csrf = novaCredencialOpaca();
  const admin = createAdminClient() as unknown as ClienteRpc;
  const { data, error } = await admin.rpc("fn_consumir_webchat_handoff", {
    p_token_digest: tokenDigest,
    p_session_digest: session.digest,
    p_csrf_digest: csrf.digest,
    p_origin: origin,
  });
  const resultado = data as Partial<SessaoVisitanteWebchat & { ok: boolean }> | null;
  if (error || !resultado?.ok || !resultado.expires_at || !resultado.sector)
    return fail("unauthenticated", "Código inválido, expirado ou já utilizado.", 401, {
      requestId,
    });
  const response = ok(
    { sector: resultado.sector, expires_at: resultado.expires_at },
    { requestId },
  );
  response.cookies.set(
    WEBCHAT_SESSION_COOKIE,
    session.raw,
    opcoesCookieWebchat(resultado.expires_at, true),
  );
  response.cookies.set(
    WEBCHAT_CSRF_COOKIE,
    csrf.raw,
    opcoesCookieWebchat(resultado.expires_at, false),
  );
  return response;
}
