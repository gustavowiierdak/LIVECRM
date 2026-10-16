import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { sendMessageSchema } from "@/lib/schemas";
import { assertCurrentServiceBoundary, parseServiceBoundary } from "@/lib/atendimento/fronteira";
import { currentExecutionBoundary } from "@/lib/atendimento/fronteira-server";
import { readServiceBoundarySupabase } from "@/lib/atendimento/origem";
import { assertOrgOperante } from "@/lib/organizacao/operante";
import { espacarEnvio } from "@/lib/automation/throttle";
import { lerVinculoIxc } from "./vinculo-do-contato";
import { carregarIntegracaoIxc } from "./integration";
import { consultarOrdemIxc } from "./suporte";
import { avisoDaOrdemIxc, type EstadoOrdemIxc } from "./aviso-os";

const TABELA = "ixc_service_order_watches";
interface Registro {
  organizationId: string;
  conversationId: string;
  contactId: string;
  customerId: string;
  contractId: string;
  orderId: string;
  estado: EstadoOrdemIxc;
}

/** Uma origem imutável, não o atendimento que estiver aberto no próximo tick. */
export async function acompanharOrdemIxc(db: SupabaseClient, input: Registro): Promise<boolean> {
  const config = await carregarIntegracaoIxc(db, input.organizationId, "monitor_service_orders");
  if (!config.ok) return false;
  const atual = await readServiceBoundarySupabase(db, input.organizationId, input.conversationId);
  const boundary = currentExecutionBoundary() ?? atual;
  assertCurrentServiceBoundary(boundary, atual);
  if (!boundary || boundary.contact_id !== input.contactId)
    throw new Error("ixc_watch_scope_mismatch");
  const { data: registro, error } = await db
    .from(TABELA)
    .upsert(
      {
        organization_id: input.organizationId,
        contact_id: input.contactId,
        conversation_id: input.conversationId,
        service_revision: boundary.service_revision,
        service_boundary: boundary,
        customer_id: input.customerId,
        contract_id: input.contractId,
        order_id: input.orderId,
        // O.S. já finalizada também precisa perguntar se resolveu, sem alegar resolução.
        snapshot: input.estado.status === "F" ? { status: "" } : input.estado,
      },
      {
        onConflict: "organization_id,conversation_id,service_revision,order_id",
        ignoreDuplicates: true,
      },
    )
    .select("id")
    .maybeSingle();
  if (error) throw new Error("ixc_watch_not_saved");
  if (!registro) return true; // Replay não apaga snapshot, recibo ou confirmação.
  const { data: inbox, error: inboxError } = await db
    .from("agent_inbox_items")
    .insert({
      organization_id: input.organizationId,
      kind: "other",
      severity: "info",
      status: "open",
      ref_kind: "conversation",
      ref_id: input.conversationId,
      title: `Acompanhar O.S. ${input.orderId}`,
      body: `Contrato ${input.contractId}: acompanhando agendamento e finalização no IXC. O atendimento só será encerrado após a confirmação do cliente.`,
    })
    .select("id")
    .single();
  if (inboxError || !inbox) throw new Error("ixc_watch_inbox_not_saved");
  const { error: erroVinculo } = await db
    .from(TABELA)
    .update({ inbox_item_id: inbox.id })
    .eq("organization_id", input.organizationId)
    .eq("id", registro.id);
  if (erroVinculo) throw new Error("ixc_watch_inbox_not_linked");
  return true;
}

interface Watch {
  id: string;
  organization_id: string;
  contact_id: string;
  conversation_id: string;
  customer_id: string;
  contract_id: string;
  order_id: string;
  service_revision: number;
  service_boundary: unknown;
  snapshot: EstadoOrdemIxc;
  state: string;
  next_poll_at: string;
  notice_state: string;
  inbox_item_id: string | null;
  last_notice_id?: string | null;
}

async function pendencia(db: SupabaseClient, w: Watch, body: string, severity = "warn") {
  if (w.inbox_item_id) {
    const { error, data } = await db
      .from("agent_inbox_items")
      .update({ body, severity, status: "open" })
      .eq("organization_id", w.organization_id)
      .eq("id", w.inbox_item_id)
      .select("id")
      .maybeSingle();
    if (!error && data) return;
  }
  const { data, error } = await db
    .from("agent_inbox_items")
    .insert({
      organization_id: w.organization_id,
      kind: "other",
      severity,
      status: "open",
      ref_kind: "conversation",
      ref_id: w.conversation_id,
      title: `Acompanhar O.S. ${w.order_id}`,
      body,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error("ixc_watch_inbox_unavailable");
  await db
    .from(TABELA)
    .update({ inbox_item_id: data.id })
    .eq("organization_id", w.organization_id)
    .eq("id", w.id);
  w.inbox_item_id = data.id;
}

/** Varredura limitada; o CAS do próximo poll reserva a linha para um único tick. */
export async function verificarOrdensAcompanhadas(db: SupabaseClient, now = new Date()) {
  const { data, error } = await db
    .from(TABELA)
    .select("*")
    .in("state", ["active", "awaiting_confirmation"])
    .lte("next_poll_at", now.toISOString())
    .order("next_poll_at")
    .limit(3);
  if (error) throw new Error("ixc_watch_query_failed");
  let avisados = 0;
  for (const w of (data ?? []) as Watch[]) {
    const { data: claim, error: claimError } = await db
      .from(TABELA)
      .update({ next_poll_at: new Date(now.getTime() + 300_000).toISOString() })
      .eq("organization_id", w.organization_id)
      .eq("id", w.id)
      .eq("next_poll_at", w.next_poll_at)
      .in("state", ["active", "awaiting_confirmation"])
      .select("id")
      .maybeSingle();
    if (claimError || !claim) continue;
    try {
      await assertOrgOperante(db, w.organization_id);
      const atual = await readServiceBoundarySupabase(db, w.organization_id, w.conversation_id);
      const boundary = parseServiceBoundary(w.service_boundary);
      try {
        assertCurrentServiceBoundary(boundary, atual);
      } catch {
        await db
          .from(TABELA)
          .update({ state: "stopped" })
          .eq("organization_id", w.organization_id)
          .eq("id", w.id);
        await pendencia(
          db,
          w,
          "O atendimento original foi encerrado ou substituído. O acompanhamento automático parou sem enviar em outro atendimento. Confira a O.S. no IXC.",
        );
        continue;
      }
      const { data: contato, error: erroContato } = await db
        .from("contacts")
        .select("source_metadata,force_human,is_blocked,is_personal")
        .eq("organization_id", w.organization_id)
        .eq("id", w.contact_id)
        .maybeSingle();
      const { data: conversa, error: erroConversa } = await db
        .from("conversations")
        .select("channel_session_id,assigned_to_user_id,assignee_kind,bot_silenced_until")
        .eq("organization_id", w.organization_id)
        .eq("id", w.conversation_id)
        .maybeSingle();
      if (erroContato || erroConversa || !contato || !conversa)
        throw new Error("ixc_watch_scope_unavailable");
      if (
        lerVinculoIxc(contato.source_metadata)?.customer_id !== w.customer_id ||
        contato.is_blocked ||
        contato.is_personal
      ) {
        await db
          .from(TABELA)
          .update({ state: "stopped" })
          .eq("organization_id", w.organization_id)
          .eq("id", w.id);
        await pendencia(
          db,
          w,
          "Acompanhamento interrompido: confira o vínculo IXC ou a permissão de contato. Nenhum aviso foi enviado.",
        );
        continue;
      }
      if (
        contato.force_human ||
        conversa.assigned_to_user_id ||
        conversa.assignee_kind === "user" ||
        (conversa.bot_silenced_until && Date.parse(conversa.bot_silenced_until) > now.getTime())
      ) {
        await pendencia(
          db,
          w,
          "Atendimento com humano ou automático pausado. A equipe deve conferir a O.S. e avisar o cliente; ao devolver ao automático, a consulta será retomada.",
          "info",
        );
        continue;
      }
      const [config, leitura] = await Promise.all([
        carregarIntegracaoIxc(db, w.organization_id, "monitor_service_orders"),
        carregarIntegracaoIxc(db, w.organization_id, "service_orders"),
      ]);
      if (!config.ok || !leitura.ok) {
        await pendencia(
          db,
          w,
          "Acompanhamento pausado na integração IXC. Habilite a consulta de O.S. e os avisos, ou acompanhe manualmente.",
        );
        continue;
      }
      // Tentativa incerta nunca é repetida cegamente, mesmo após reinício do processo.
      if (["attempting", "review"].includes(w.notice_state)) {
        const { data: recibo } = w.last_notice_id
          ? await db
              .from("messages")
              .select("id,status,metadata")
              .eq("organization_id", w.organization_id)
              .eq("conversation_id", w.conversation_id)
              .eq("id", w.last_notice_id)
              .maybeSingle()
          : { data: null };
        if (
          recibo?.metadata?.ixc_order_watch_id === w.id &&
          ["sent", "delivered", "read"].includes(recibo.status)
        ) {
          const { error: erroRecuperacao } = await db
            .from(TABELA)
            .update({ notice_state: "sent" })
            .eq("organization_id", w.organization_id)
            .eq("id", w.id);
          if (erroRecuperacao) throw new Error("ixc_watch_receipt_unavailable");
          await pendencia(
            db,
            w,
            "A entrega do aviso foi confirmada pelo histórico. Continue acompanhando; a finalização no IXC ainda exige confirmação do cliente.",
            "info",
          );
        } else {
          await pendencia(
            db,
            w,
            "Um aviso de O.S. ficou sem confirmação de entrega. Confira o histórico e avise manualmente se necessário; o sistema não repetirá esse envio.",
          );
          if (w.notice_state === "attempting") {
            await db
              .from(TABELA)
              .update({ notice_state: "review" })
              .eq("organization_id", w.organization_id)
              .eq("id", w.id);
          }
        }
        // Continua observando futuras mudanças, sem reenviar a versão incerta.
      }
      const ordem = await consultarOrdemIxc(
        leitura.baseUrl,
        leitura.token,
        w.customer_id,
        w.contract_id,
        w.order_id,
      );
      const aviso = avisoDaOrdemIxc(w.order_id, w.snapshot, ordem);
      if (!aviso) {
        if (ordem.status !== w.snapshot.status) {
          const reaberta = w.snapshot.status === "F" && ordem.status !== "F";
          await db
            .from(TABELA)
            .update({
              snapshot: {
                status: ordem.status,
                data_agenda: ordem.data_agenda,
                data_agenda_final: ordem.data_agenda_final,
              },
              ...(reaberta ? { state: "active", last_notice_id: null } : {}),
            })
            .eq("organization_id", w.organization_id)
            .eq("id", w.id);
          if (reaberta)
            await pendencia(
              db,
              w,
              "A O.S. foi reaberta no IXC. Continuar acompanhando o atendimento; não encerrar com base na finalização anterior.",
              "info",
            );
        }
        continue;
      }
      const messageId = randomUUID();
      const { error: erroReserva } = await db
        .from(TABELA)
        .update({
          snapshot: {
            status: ordem.status,
            data_agenda: ordem.data_agenda,
            data_agenda_final: ordem.data_agenda_final,
          },
          notice_state: "attempting",
          last_notice_id: messageId,
          state: aviso.tipo === "finalizacao" ? "awaiting_confirmation" : "active",
        })
        .eq("organization_id", w.organization_id)
        .eq("id", w.id);
      if (erroReserva) throw new Error("ixc_watch_notice_not_reserved");
      await pendencia(
        db,
        w,
        `O.S. ${w.order_id}: aviso de ${aviso.tipo} em envio. Se não houver recibo no histórico, confira a entrega antes de repetir.`,
      );
      await espacarEnvio(conversa.channel_session_id);
      const mensagem = await sendMessageHandler(
        db,
        {
          organization_id: w.organization_id,
          actor: { type: "ai_agent", id: "ixc-os-monitor", role: "agent" },
          requestId: messageId,
          internalMessageId: messageId,
          serviceBoundary: boundary,
        },
        sendMessageSchema.parse({
          conversation_id: w.conversation_id,
          type: "text",
          body: aviso.texto,
          metadata: {
            idempotency_key: `ixc-os:${w.id}:${messageId}`,
            ixc_order_watch_id: w.id,
            ixc_order_notice: aviso.tipo,
          },
        }),
      );
      if (!["sent", "delivered", "read"].includes(mensagem.status))
        throw new Error("ixc_watch_notice_unconfirmed");
      const { error: erroRecibo } = await db
        .from(TABELA)
        .update({ notice_state: "sent", last_notice_id: mensagem.id })
        .eq("organization_id", w.organization_id)
        .eq("id", w.id);
      if (erroRecibo) throw new Error("ixc_watch_receipt_unavailable");
      await pendencia(
        db,
        w,
        aviso.tipo === "finalizacao"
          ? `O.S. ${w.order_id} finalizada no IXC. Aviso enviado; aguardando o cliente confirmar se a conexão foi normalizada. Não encerrar por silêncio ou agradecimento.`
          : `Aviso enviado: ${aviso.texto} Acompanhar até a confirmação da solução.`,
        "info",
      );
      avisados += 1;
    } catch {
      await pendencia(
        db,
        w,
        "Não foi possível concluir a consulta ou o aviso da O.S. Confira a integração IXC e o histórico de mensagens; mantenha o cliente acompanhado.",
      );
    }
  }
  return { examinados: data?.length ?? 0, avisados };
}
