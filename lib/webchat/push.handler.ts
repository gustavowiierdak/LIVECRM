import webpush from "web-push";

import type { EventHandler } from "@/lib/event-log/dispatcher";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { vapidPronto, vapidPublica, vapidSubject } from "@/lib/notifications/vapid";
import { createAdminClient } from "@/lib/supabase/admin";

export const WEBCHAT_PUSH_KEY = "webchat-push-visitor.v1";

export const webchatPushHandler: EventHandler = {
  key: WEBCHAT_PUSH_KEY,
  naOrgParada: "pula",
  events: ["webchat.reply_created"],
  async handle(row) {
    const skip = (detail: string) => ({ consumer_key: WEBCHAT_PUSH_KEY, status: "skipped" as const, detail });
    if (!vapidPronto()) return skip("vapid_ausente");
    if (!row.entity_id) return skip("sem_mensagem");
    const admin = createAdminClient();
    const { data: message, error: messageError } = await admin.from("webchat_messages")
      .select("id,visitor_session_id,direction,created_at")
      .eq("id", row.entity_id)
      .eq("organization_id", row.organization_id)
      .maybeSingle();
    if (messageError) return { consumer_key: WEBCHAT_PUSH_KEY, status: "error", detail: "leitura_mensagem" };
    if (!message || message.direction !== "operator") return skip("resposta_ausente");

    const { data: session, error: sessionError } = await admin.from("webchat_visitor_sessions")
      .select("id,expires_at,revoked_at,source_conversation_id")
      .eq("id", message.visitor_session_id)
      .eq("organization_id", row.organization_id)
      .maybeSingle();
    if (sessionError) return { consumer_key: WEBCHAT_PUSH_KEY, status: "error", detail: "leitura_sessao" };
    if (!session || session.revoked_at || new Date(session.expires_at).getTime() <= Date.now())
      return skip("sessao_inativa");

    const [{ data: config, error: configError }, { data: conversation, error: conversationError }] = await Promise.all([
      admin.from("webchat_channel_configs").select("public_id,enabled")
        .eq("organization_id", row.organization_id).maybeSingle(),
      admin.from("conversations").select("status")
        .eq("organization_id", row.organization_id)
        .eq("id", session.source_conversation_id).maybeSingle(),
    ]);
    if (configError || conversationError)
      return { consumer_key: WEBCHAT_PUSH_KEY, status: "error", detail: "leitura_contexto" };
    if (!config?.enabled || !conversation || ["closed", "resolved", "archived"].includes(conversation.status))
      return skip("atendimento_encerrado");

    // A tabela nova ainda nao esta nos tipos gerados. O filtro de org e sessao
    // permanece explicito porque o service role ignora RLS.
    const { data, error } = await admin.from("webchat_push_subscriptions" as never)
      .select("id,endpoint,p256dh,auth,created_at")
      .eq("organization_id" as never, row.organization_id)
      .eq("visitor_session_id" as never, session.id);
    if (error) return { consumer_key: WEBCHAT_PUSH_KEY, status: "error", detail: "leitura_inscricoes" };
    type Subscription = { id: string; endpoint: string; p256dh: string; auth: string; created_at: string };
    const subscriptions = (data ?? []) as Subscription[];
    const active = subscriptions.filter((sub) =>
      new Date(sub.created_at).getTime() <= new Date(message.created_at).getTime(),
    );
    if (active.length === 0) return skip("sem_inscricao_na_resposta");

    webpush.setVapidDetails(await vapidSubject(), vapidPublica()!, env.VAPID_PRIVATE_KEY.trim());
    const payload = JSON.stringify({
      title: "Nova resposta no atendimento",
      body: "Toque para abrir a conversa.",
      tag: `webchat:${session.id}`,
      href: `/atendimento/${config.public_id}`,
      channel: "webchat",
    });
    let sent = 0;
    await Promise.all(active.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload,
        );
        sent += 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await admin.from("webchat_push_subscriptions" as never).delete()
            .eq("organization_id" as never, row.organization_id)
            .eq("id" as never, sub.id);
        } else {
          logger.warn("webchat_push_send_failed", { status: status ?? 0 });
        }
      }
    }));
    return { consumer_key: WEBCHAT_PUSH_KEY, status: "ok", detail: `sent:${sent}` };
  },
};
