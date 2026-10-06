import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  WEBCHAT_CSRF_COOKIE,
  WEBCHAT_SESSION_COOKIE,
  novaCredencialOpaca,
  opcoesCookieWebchat,
  originDaRequisicao,
  setorWebchatSchema,
} from "@/lib/webchat/seguranca";
import type { MensagemWebchat, SessaoVisitanteWebchat } from "@/lib/webchat/types";

const corpoSchema = z.object({
  public_id: z.uuid(),
  name: z.string().trim().min(2).max(80),
  sector: setorWebchatSchema,
  body: z.string().trim().min(1).max(4000),
  idempotency_key: z.uuid(),
}).strict();

type Resultado = SessaoVisitanteWebchat & {
  ok: boolean;
  organization_id: string;
  conversation_id: string;
  message: MensagemWebchat;
};

/** Primeiro contato público: nenhuma identidade/organização é aceita do body. */
export async function POST(request: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const origin = originDaRequisicao(request);
  if (!origin) return fail("forbidden", "Origem inválida.", 403, { requestId });
  const parsed = corpoSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("validation_error", "Dados do atendimento inválidos.", 422, {
    requestId, details: parsed.error.flatten().fieldErrors,
  });
  const limite = await checkRateLimit(`webchat:start:${parsed.data.public_id}`, 30, 60);
  if (!limite.allowed) return fail("rate_limited", "Tente novamente em instantes.", 429, { requestId });

  const session = novaCredencialOpaca();
  const csrf = novaCredencialOpaca();
  const admin = createAdminClient() as unknown as {
    rpc: (name: string, params: Record<string, unknown>) => Promise<{
      data: unknown; error: { message: string } | null;
    }>;
  };
  const { data, error } = await admin.rpc("fn_iniciar_webchat_publico", {
    p_public_id: parsed.data.public_id,
    p_origin: origin,
    p_name: parsed.data.name,
    p_sector: parsed.data.sector,
    p_body: parsed.data.body,
    p_session_digest: session.digest,
    p_csrf_digest: csrf.digest,
    p_idempotency_key: parsed.data.idempotency_key,
  });
  const resultado = data as Resultado | null;
  if (error) return fail("internal_error", "Não foi possível iniciar o atendimento.", 500, { requestId });
  if (!resultado?.ok || !resultado.expires_at || !resultado.message)
    return fail("forbidden", "Este link de atendimento não está disponível.", 403, { requestId });

  void audit({
    action: "webchat.public_started",
    organizationId: resultado.organization_id,
    resourceType: "conversation",
    resourceId: resultado.conversation_id,
    requestId,
    metadata: { sector: resultado.sector, channel: "webchat" },
  });
  const response = ok({ sector: resultado.sector, expires_at: resultado.expires_at,
    message: resultado.message }, { requestId, status: 201 });
  response.cookies.set(WEBCHAT_SESSION_COOKIE, session.raw,
    opcoesCookieWebchat(resultado.expires_at, true));
  response.cookies.set(WEBCHAT_CSRF_COOKIE, csrf.raw,
    opcoesCookieWebchat(resultado.expires_at, false));
  return response;
}
