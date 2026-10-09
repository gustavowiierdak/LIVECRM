import { aplicarEfeitosPosEntrada } from "@/lib/channels/pos-entrada";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

/** A RPC é a fonte dos IDs: nunca recebemos org/conversa do body público. */
export async function processarEntradaWebchat(
  admin: ReturnType<typeof createAdminClient>,
  entrada: { organizationId: string; conversationId: string; messageId: string; requestId: string },
): Promise<void> {
  const { data: conversa } = await admin.from("conversations")
    .select("channel")
    .eq("organization_id", entrada.organizationId)
    .eq("id", entrada.conversationId)
    .maybeSingle();
  if (conversa?.channel !== "webchat") return;
  const { data: mensagem, error } = await admin
    .from("messages")
    .select("id,body,contact_id,channel_session_id")
    .eq("organization_id", entrada.organizationId)
    .eq("conversation_id", entrada.conversationId)
    .eq("id", entrada.messageId)
    .eq("direction", "inbound")
    .maybeSingle();
  if (error || !mensagem?.contact_id || !mensagem.channel_session_id) {
    logger.error("[webchat] entrada canônica indisponível para o agente", {
      organizationId: entrada.organizationId,
      conversationId: entrada.conversationId,
      messageId: entrada.messageId,
      error: error?.message ?? "message_missing",
    });
    return;
  }
  const { data: contato } = await admin
    .from("contacts")
    .select("display_name,name,force_human")
    .eq("organization_id", entrada.organizationId)
    .eq("id", mensagem.contact_id)
    .maybeSingle();
  const { data: agenteConfigurado, error: configError } = await admin.rpc(
    "fn_webchat_tem_agente_configurado", {
      p_org: entrada.organizationId,
      p_channel_session_id: mensagem.channel_session_id,
    },
  );
  if (configError) logger.warn("[webchat] vínculo do agente indisponível; atendimento segue humano", {
    organizationId: entrada.organizationId, conversationId: entrada.conversationId,
    error: configError.message,
  });
  await aplicarEfeitosPosEntrada(admin, {
    organizationId: entrada.organizationId,
    contactId: mensagem.contact_id,
    conversationId: entrada.conversationId,
    messageId: mensagem.id,
    channelSessionId: mensagem.channel_session_id,
    texto: mensagem.body,
    nomeDoContato: contato?.display_name ?? contato?.name ?? null,
    requestId: entrada.requestId,
    origem: "webchat",
    canal: conversa.channel,
    despacharAgente: agenteConfigurado === true && contato?.force_human === false,
  });
}
