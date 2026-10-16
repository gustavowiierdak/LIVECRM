import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { vapidPronto, vapidPublica } from "@/lib/notifications/vapid";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  WEBCHAT_CSRF_COOKIE, WEBCHAT_SESSION_COOKIE, digestWebchat,
  origemDeLeituraWebchat, originDaRequisicao,
} from "@/lib/webchat/seguranca";

export const dynamic = "force-dynamic";

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2048).refine((value) => value.startsWith("https://")),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{40,200}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{10,100}$/),
  }),
});

async function sessaoDaRequisicao(request: NextRequest, mutation: boolean) {
  const store = await cookies();
  const raw = store.get(WEBCHAT_SESSION_COOKIE)?.value;
  const csrf = store.get(WEBCHAT_CSRF_COOKIE)?.value;
  const origin = mutation ? originDaRequisicao(request) : origemDeLeituraWebchat(request);
  if (!raw || !origin || (mutation && (!csrf || request.headers.get("x-webchat-csrf") !== csrf)))
    return null;
  const sessionDigest = digestWebchat(raw);
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("fn_webchat_sessao_visitante", {
    p_session_digest: sessionDigest,
    p_origin: origin,
  });
  const validation = data as { ok?: boolean; active?: boolean; public_id?: string } | null;
  if (error || !validation?.ok || !validation.active) return null;
  const requestedPublicId = request.headers.get("x-webchat-public-id");
  if (requestedPublicId && requestedPublicId !== validation.public_id) return null;
  const { data: session } = await admin.from("webchat_visitor_sessions")
    .select("id,organization_id,expires_at,revoked_at")
    .eq("session_digest", sessionDigest).maybeSingle();
  if (!session || session.revoked_at || new Date(session.expires_at).getTime() <= Date.now()) return null;
  return { admin, session };
}

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!(await sessaoDaRequisicao(request, false)))
    return fail("unauthenticated", "Sessão de atendimento inválida.", 401, { requestId });
  return ok({ enabled: vapidPronto(), public_key: vapidPublica() }, { requestId });
}

export async function PUT(request: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const context = await sessaoDaRequisicao(request, true);
  if (!context) return fail("forbidden", "Sessão de atendimento inválida.", 403, { requestId });
  if (!vapidPronto())
    return fail("unavailable", "Notificações do sistema indisponíveis nesta instalação.", 503, { requestId });
  const rate = await checkRateLimit(`webchat:push:${context.session.id}`, 10, 60);
  if (!rate.allowed) return fail("rate_limited", "Aguarde para tentar novamente.", 429, { requestId });
  const parsed = subscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("validation_error", "Inscrição inválida.", 422, { requestId });
  const { error } = await context.admin.from("webchat_push_subscriptions" as never).upsert({
    organization_id: context.session.organization_id,
    visitor_session_id: context.session.id,
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
    updated_at: new Date().toISOString(),
  } as never, { onConflict: "endpoint" });
  if (error) return fail("internal_error", "Não foi possível ativar as notificações.", 500, { requestId });
  void audit({
    action: "notification_prefs.changed",
    organizationId: context.session.organization_id,
    resourceType: "webchat_push_subscription",
    resourceId: context.session.id,
    requestId,
    metadata: { channel: "web_push", enabled: true },
  });
  return ok({ enabled: true }, { requestId });
}

export async function DELETE(request: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const context = await sessaoDaRequisicao(request, true);
  if (!context) return fail("forbidden", "Sessão de atendimento inválida.", 403, { requestId });
  const rate = await checkRateLimit(`webchat:push:${context.session.id}`, 10, 60);
  if (!rate.allowed) return fail("rate_limited", "Aguarde para tentar novamente.", 429, { requestId });
  const parsed = z.object({ endpoint: subscriptionSchema.shape.endpoint }).safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return fail("validation_error", "Inscrição inválida.", 422, { requestId });
  const { error } = await context.admin.from("webchat_push_subscriptions" as never).delete()
    .eq("organization_id" as never, context.session.organization_id)
    .eq("visitor_session_id" as never, context.session.id)
    .eq("endpoint" as never, parsed.data.endpoint);
  if (error) return fail("internal_error", "Não foi possível desativar as notificações.", 500, { requestId });
  void audit({
    action: "notification_prefs.changed",
    organizationId: context.session.organization_id,
    resourceType: "webchat_push_subscription",
    resourceId: context.session.id,
    requestId,
    metadata: { channel: "web_push", enabled: false },
  });
  return ok({ enabled: false }, { requestId });
}
