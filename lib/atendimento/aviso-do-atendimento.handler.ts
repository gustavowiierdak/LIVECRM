import { z } from "zod";
import type { EventHandler } from "@/lib/event-log/dispatcher";
import { createAdminClient } from "@/lib/supabase/admin";
import { estadoDaJanela } from "@/lib/channels/janela";
import { OrgNaoOperanteError } from "@/lib/organizacao/operante";

export const AVISO_ATENDIMENTO_KEY = "attendance-notice.v1";
const payloadSchema = z.object({ notice_id: z.uuid() });
const terminais = new Set(["closed", "resolved", "archived"]);

export const avisoDoAtendimentoHandler: EventHandler = {
  key: AVISO_ATENDIMENTO_KEY,
  events: ["attendance.notice_requested"],
  naOrgParada: "pula",
  async handle(row) {
    const result = (status: "ok" | "skipped" | "error" | "retry", detail: string) => ({
      consumer_key: AVISO_ATENDIMENTO_KEY,
      status,
      detail,
      ...(status === "retry" ? { retry_at: new Date(Date.now() + 15_000).toISOString() } : {}),
    });
    const parsed = payloadSchema.safeParse(row.payload);
    if (!parsed.success || !row.entity_id) return result("skipped", "aviso_invalido");
    const admin = createAdminClient();
    // A mensagem vem da outbox escrita pelo trigger, NÃO do payload do evento.
    const { data: notice, error } = await admin
      .from("attendance_notices")
      .select("*")
      .eq("id", parsed.data.notice_id)
      .eq("organization_id", row.organization_id)
      .eq("conversation_id", row.entity_id)
      .maybeSingle();
    if (error) return result("error", "leitura_aviso");
    if (!notice) return result("skipped", "aviso_ausente");
    const { data: conv, error: convError } = await admin
      .from("conversations")
      .select(
        "service_protocol,status,channel,is_group,assigned_to_user_id,last_inbound_at,channel_sessions(provider)",
      )
      .eq("id", row.entity_id)
      .eq("organization_id", row.organization_id)
      .maybeSingle();
    if (convError) return result("error", "leitura_atendimento");
    if (
      !conv ||
      conv.is_group ||
      conv.channel === "webchat" ||
      conv.service_protocol !== notice.protocol
    )
      return result("skipped", "atendimento_obsoleto");
    if ((notice.kind === "encerrado") !== terminais.has(conv.status))
      return result("skipped", "estado_obsoleto");
    if (notice.kind === "assumido" && conv.assigned_to_user_id !== notice.assigned_to_user_id)
      return result("skipped", "responsavel_mudou");
    const session = Array.isArray(conv.channel_sessions)
      ? conv.channel_sessions[0]
      : conv.channel_sessions;
    if (estadoDaJanela(session?.provider, conv.last_inbound_at, new Date()).tipo === "fechada")
      return result("error", "janela_fechada_requer_modelo_aprovado");
    const { data: existing, error: existingError } = await admin
      .from("messages")
      .select("id,status")
      .eq("id", notice.id)
      .eq("organization_id", row.organization_id)
      .eq("conversation_id", row.entity_id)
      .maybeSingle();
    if (existingError) return result("error", "leitura_recibo");
    if (existing && ["sent", "delivered", "read"].includes(existing.status))
      return result("ok", "ja_enviado");
    if (existing?.status === "sending") return result("retry", "envio_em_andamento");
    if (existing?.status === "failed") return result("error", "envio_falhou_confira_a_conversa");
    const { sendMessageHandler } = await import("@/app/api/v1/messages/_handler");
    try {
      const sent = await sendMessageHandler(
        admin,
        {
          organization_id: row.organization_id,
          actor: { type: "webhook_source", id: "attendance-notice" },
          requestId: notice.id,
          internalMessageId: notice.id,
          attendanceNotice: { noticeId: notice.id },
        },
        {
          conversation_id: row.entity_id,
          type: "text",
          body: notice.body,
          metadata: { attendance_notice: notice.kind, service_protocol: notice.protocol },
        },
      );
      if (["sent", "delivered", "read"].includes(sent.status)) return result("ok", "enviado");
      return result(sent.status === "failed" ? "error" : "retry", "aguardando_entrega");
    } catch (error) {
      if (error instanceof OrgNaoOperanteError) return result("skipped", "org_nao_operante");
      // Recusa fica no evento e, após o teto do dreno, na Central de avisos.
      // Não imprimir erro bruto: transportes podem carregar dados do cliente.
      return result("error", error instanceof Error ? error.name : "falha_envio");
    }
  },
};
