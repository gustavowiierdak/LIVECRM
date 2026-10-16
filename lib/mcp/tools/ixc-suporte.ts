import { createHash } from "node:crypto";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { hashDaColuna } from "@/lib/api/idempotency";
import { buscarClienteIxc, criarOrdemIxc, listarContratosIxc } from "@/lib/ixc/client";
import { carregarIntegracaoIxc, type IxcResource } from "@/lib/ixc/integration";
import {
  consultarDiagnosticoIxc,
  consultarPagamentoIxc,
  listarOrdensIxc,
  resolverDestinoOrdemIxc,
} from "@/lib/ixc/suporte";
import { situacaoDoContratoIxc } from "@/lib/ixc/situacao-do-contrato";
import { acompanharOrdemIxc } from "@/lib/ixc/acompanhamento-os";
import { confirmarDocumentoDoTurno, respostaCadastroAmbiguo } from "./documento-confirmado";
import { autorizacaoInequivocaParaDesbloqueio } from "./ixc";
import type { McpContext, McpToolDefinition } from "../types";

const inputShape = {
  document: z.string().trim().min(11).max(18),
  customer_id: z
    .string()
    .regex(/^\d{1,20}$/)
    .optional(),
  contract_id: z
    .string()
    .regex(/^\d{1,20}$/)
    .describe("Contrato/endereço confirmado pelo cliente em crm_list_ixc_contracts."),
};
type Entrada = z.infer<z.ZodObject<typeof inputShape>>;

async function escopo(input: Entrada, ctx: McpContext, recurso: IxcResource) {
  const documento = await confirmarDocumentoDoTurno(
    ctx,
    input.document,
    "cadastro",
    input.customer_id,
  );
  if (!documento.ok) return { ok: false as const, resposta: documento.resposta };
  const [clientes, contratos, integracao] = await Promise.all([
    carregarIntegracaoIxc(ctx.supabase, ctx.organizationId, "customers"),
    carregarIntegracaoIxc(ctx.supabase, ctx.organizationId, "contracts"),
    carregarIntegracaoIxc(ctx.supabase, ctx.organizationId, recurso),
  ]);
  if (!clientes.ok || !contratos.ok || !integracao.ok)
    return {
      ok: false as const,
      resposta: {
        erro: "recurso_ixc_indisponivel",
        mensagem:
          "A consulta/ação necessária não está habilitada na integração IXC. Encaminhe o caso com o motivo; não simule o resultado.",
      },
    };
  const cliente = await buscarClienteIxc(
    clientes.baseUrl,
    clientes.token,
    documento.document,
    undefined,
    documento.customerId,
  );
  if (!cliente) return { ok: false as const, resposta: { erro: "cliente_nao_encontrado" } };
  const lista = await listarContratosIxc(contratos.baseUrl, contratos.token, cliente.id);
  const contrato = lista.find((v) => v.id === input.contract_id);
  if (!contrato) return { ok: false as const, resposta: { erro: "contrato_fora_do_cliente" } };
  return { ok: true as const, cliente, contrato, integracao };
}

function falha(error: unknown) {
  return (
    respostaCadastroAmbiguo(error) ?? {
      erro: "consulta_ixc_indisponivel",
      mensagem:
        "Não foi possível confirmar os dados no IXC. Não trate ausência de resultado como sucesso ou ausência de problema.",
    }
  );
}
const redigir = () => ({ document: "[redigido]" });

async function revisao(ctx: McpContext) {
  try {
    const { data: existente } = await ctx.supabase
      .from("agent_inbox_items")
      .select("id")
      .eq("organization_id", ctx.organizationId)
      .eq("ref_kind", "conversation")
      .eq("ref_id", ctx.conversationIdDoTurno)
      .eq("title", "Conferir criação de O.S. no IXC")
      .eq("status", "open")
      .limit(1)
      .maybeSingle();
    if (existente?.id) return true;
    const { error } = await ctx.supabase.from("agent_inbox_items").insert({
      organization_id: ctx.organizationId,
      kind: "other",
      ref_kind: "conversation",
      ref_id: ctx.conversationIdDoTurno,
      status: "open",
      title: "Conferir criação de O.S. no IXC",
      severity: "warn",
      body: "O IXC pode ter recebido a O.S., mas a confirmação não foi concluída. Conferir o contrato antes de tentar novamente.",
    });
    return !error;
  } catch {
    return false;
  }
}

export const crmGetIxcDiagnostics: McpToolDefinition<typeof inputShape> = {
  name: "crm_get_ixc_diagnostics",
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  description:
    "Consulta conexão RADIUS e últimas medições ópticas do contrato escolhido. Use no suporte após selecionar o contrato. Datas antigas e resultado desconhecido não provam situação atual. Não afirma incidente regional.",
  inputSchema: inputShape,
  redigirParaAuditoria: redigir,
  handler: async (input, ctx) => {
    try {
      const e = await escopo(input, ctx, "diagnostics");
      if (!e.ok) return e.resposta;
      return await consultarDiagnosticoIxc(
        e.integracao.baseUrl,
        e.integracao.token,
        e.cliente.id,
        e.contrato.id,
      );
    } catch (error) {
      return falha(error);
    }
  },
};

export const crmListIxcServiceOrders: McpToolDefinition<typeof inputShape> = {
  name: "crm_list_ixc_service_orders",
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  description:
    "Consulta O.S. e agendamento reais do contrato escolhido. Use antes de abrir visita e em pedidos de acompanhamento, reagendamento ou cancelamento. Sem data no IXC, não prometa horário; alterações de agenda/cancelamento devem ser encaminhadas à equipe com o número da O.S.",
  inputSchema: inputShape,
  redigirParaAuditoria: redigir,
  handler: async (input, ctx) => {
    try {
      const e = await escopo(input, ctx, "service_orders");
      if (!e.ok) return e.resposta;
      return {
        ordens: await listarOrdensIxc(
          e.integracao.baseUrl,
          e.integracao.token,
          e.cliente.id,
          e.contrato.id,
        ),
        consultado_em: new Date().toISOString(),
      };
    } catch (error) {
      return falha(error);
    }
  },
};

const acompanharShape = { ...inputShape, order_id: z.string().regex(/^\d{1,20}$/) };
export const crmWatchIxcServiceOrder: McpToolDefinition<typeof acompanharShape> = {
  name: "crm_watch_ixc_service_order",
  category: "write",
  requiresRole: "ai_operator",
  requiresScope: "mcp:write",
  description:
    "Vincula ao atendimento atual a O.S. escolhida após consulta, para avisar agendamento, mudanças e finalização. Não cria O.S. nem altera agenda. Use somente a ordem da queixa/endereço confirmado. Nunca promete monitoramento se retornar acompanhamento_ativo=false.",
  inputSchema: acompanharShape,
  redigirParaAuditoria: redigir,
  handler: async (input, ctx) => {
    try {
      if (!ctx.sourceJobId || !ctx.contatoDoTurno || !ctx.conversationIdDoTurno)
        return { erro: "turno_real_obrigatorio" };
      const e = await escopo(input, ctx, "service_orders");
      if (!e.ok) return e.resposta;
      const ordens = await listarOrdensIxc(
        e.integracao.baseUrl,
        e.integracao.token,
        e.cliente.id,
        e.contrato.id,
      );
      const ordem = ordens.find((o) => o.id === input.order_id);
      if (!ordem) return { erro: "os_fora_do_contrato" };
      const ativo = await acompanharOrdemIxc(ctx.supabase, {
        organizationId: ctx.organizationId,
        conversationId: ctx.conversationIdDoTurno,
        contactId: ctx.contatoDoTurno,
        customerId: e.cliente.id,
        contractId: e.contrato.id,
        orderId: ordem.id,
        estado: ordem,
      });
      return {
        acompanhamento_ativo: ativo,
        ordem_id: ordem.id,
        mensagem: ativo
          ? "Acompanhamento registrado. Não encerre até o cliente confirmar que resolveu."
          : "Avisos automáticos não estão habilitados. Encaminhe o acompanhamento à equipe, sem prometer aviso automático.",
      };
    } catch (error) {
      return falha(error);
    }
  },
};

const pagamentoShape = {
  ...inputShape,
  invoice_id: z
    .string()
    .regex(/^\d{1,20}$/)
    .describe(
      "ID ERP da fatura que o cliente afirma ter pago, obtido da Bemobi ou informado no comprovante. A ferramenta confere cliente/contrato antes de retornar.",
    ),
};
export const crmCheckIxcPayment: McpToolDefinition<typeof pagamentoShape> = {
  name: "crm_check_ixc_payment",
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  description:
    "Quando o cliente disser 'já paguei e continuo sem internet', confere a baixa de UM título no IXC e o estado do contrato. Não dá baixa, não libera acesso e não considera foto de comprovante como confirmação. Se não há ID da fatura, esclareça qual título; não adivinhe.",
  inputSchema: pagamentoShape,
  redigirParaAuditoria: redigir,
  handler: async (input, ctx) => {
    try {
      const e = await escopo(input, ctx, "receivables");
      if (!e.ok) return e.resposta;
      const pagamento = await consultarPagamentoIxc(
        e.integracao.baseUrl,
        e.integracao.token,
        e.cliente.id,
        e.contrato.id,
        input.invoice_id,
      );
      const acesso = situacaoDoContratoIxc(e.contrato);
      return {
        ...pagamento,
        acesso,
        proximo_passo: !pagamento.pagamento_confirmado
          ? "Baixa ainda não confirmada nesta consulta. Confira o título/meio de pagamento; se houver divergência, encaminhe ao financeiro com o comprovante, sem dar baixa nem prometer prazo."
          : acesso.bloqueioFinanceiro
            ? "Pagamento deste título confirmado, mas o contrato segue bloqueado. Consulte outros títulos e elegibilidade de desbloqueio; peça consentimento antes de executar. Se não elegível, encaminhe a divergência."
            : "Pagamento deste título confirmado. Se a queixa persiste, continue o diagnóstico técnico; não encerre apenas por o contrato estar ativo.",
      };
    } catch (error) {
      return falha(error);
    }
  },
};

const criarShape = {
  ...inputShape,
  reason: z.enum(["sem_conexao", "lentidao"]),
  summary: z
    .string()
    .trim()
    .min(10)
    .max(4000)
    .describe(
      "Sintoma, endereço/contrato escolhido, testes já feitos e resultados. Sem documentos ou credenciais.",
    ),
  confirmation_text: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .describe(
      "Última resposta afirmativa à oferta de abrir O.S./visita. Copie literalmente; nunca invente consentimento.",
    ),
};
const ENDPOINT = "mcp:crm_create_ixc_service_order";

export const crmCreateIxcServiceOrder: McpToolDefinition<typeof criarShape> = {
  name: "crm_create_ixc_service_order",
  category: "write",
  requiresRole: "ai_operator",
  requiresScope: "mcp:write",
  description:
    "Abre O.S. no IXC para falta de conexão ou lentidão usando assunto/setor configurados. Antes diagnostique, confirme contrato/endereço, ofereça abrir O.S. e aguarde um sim. Reutiliza O.S. aberta; não agenda visita. Em resultado incerto, não repita: solicite revisão humana.",
  inputSchema: criarShape,
  redigirParaAuditoria: () => ({
    document: "[redigido]",
    summary: "[redigido]",
    confirmation_text: "[redigido]",
  }),
  handler: async (input, ctx) => {
    let reservado = false;
    let ordemConfirmada: string | undefined;
    try {
      if (!ctx.sourceJobId || !ctx.conversationIdDoTurno) return { erro: "turno_real_obrigatorio" };
      const { data: conversa } = await ctx.supabase
        .from("conversations")
        .select("contact_id")
        .eq("organization_id", ctx.organizationId)
        .eq("id", ctx.conversationIdDoTurno)
        .maybeSingle();
      if (conversa?.contact_id !== ctx.contatoDoTurno) return { erro: "conversa_fora_do_turno" };
      const e = await escopo(input, ctx, "create_service_orders");
      if (!e.ok) return e.resposta;
      const leitura = await carregarIntegracaoIxc(
        ctx.supabase,
        ctx.organizationId,
        "service_orders",
      );
      if (!leitura.ok) return { erro: "consulta_os_nao_habilitada" };
      const destino = e.integracao.routing;
      if (
        !destino?.[input.reason] ||
        !destino.setor ||
        !e.contrato.id_filial ||
        e.contrato.id_filial === "0"
      )
        return {
          erro: "configuracao_os_incompleta",
          mensagem:
            "Configure assuntos/setor na integração IXC e confira a filial do contrato. Não foi aberta O.S.",
        };
      if (situacaoDoContratoIxc(e.contrato).bloqueioFinanceiro)
        return {
          erro: "resolver_bloqueio_primeiro",
          mensagem:
            "Trate o bloqueio antes de oferecer visita. Se houver falha técnica independente, encaminhe para avaliação humana.",
        };
      if (
        e.contrato.status !== "A" ||
        situacaoDoContratoIxc(e.contrato).situacao === "desconhecido"
      )
        return {
          erro: "situacao_contrato_impede_os",
          mensagem: "Confirme a situação do contrato com a equipe antes de abrir uma visita.",
        };
      const ordens = await listarOrdensIxc(
        leitura.baseUrl,
        leitura.token,
        e.cliente.id,
        e.contrato.id,
      );
      const abertas = ordens.filter((o) => !o.finalizada);
      if (abertas.length)
        return {
          criada: false,
          existente: true,
          ordens: abertas,
          mensagem:
            "Já existe O.S. não finalizada neste contrato. Confirme se trata da mesma queixa; não duplique. Encaminhe informações novas e pedidos de agenda/cancelamento à equipe.",
        };
      const { data: mensagens, error: erroMensagens } = await ctx.supabase
        .from("messages")
        .select("direction,sent_via,body,media_derived_text")
        .eq("organization_id", ctx.organizationId)
        .eq("conversation_id", ctx.conversationIdDoTurno)
        .order("created_at", { ascending: false })
        .limit(20);
      if (erroMensagens) return { erro: "confirmacao_indisponivel" };
      const recebida = mensagens?.find((m) => m.direction === "inbound");
      const indice = recebida ? (mensagens?.indexOf(recebida) ?? -1) : -1;
      const pergunta = mensagens
        ?.slice(indice + 1)
        .find((m) => m.direction === "outbound" && m.sent_via === "ai");
      const resposta = (recebida?.body || recebida?.media_derived_text || "").trim();
      if (
        indice < 0 ||
        resposta !== input.confirmation_text.trim() ||
        !autorizacaoInequivocaParaDesbloqueio(resposta) ||
        !/visita|ordem de servi[cç]o|\bo\.?s\.?\b/i.test(pergunta?.body ?? "")
      )
        return {
          erro: "confirmacao_os_ausente",
          mensagem: "Ofereça abrir uma ordem de serviço e aguarde a confirmação do cliente.",
        };
      const ids = await resolverDestinoOrdemIxc(
        e.integracao.baseUrl,
        e.integracao.token,
        destino[input.reason],
        destino.setor,
      );
      // Mesmo contrato + mesma geração de histórico = uma reserva, inclusive em dois turnos simultâneos.
      const geracao = ordens
        .map((o) => BigInt(o.id))
        .reduce((a, b) => (a > b ? a : b), 0n)
        .toString();
      const chave = createHash("sha256").update(`${e.contrato.id}:${geracao}`).digest("hex");
      const { error: erroReserva } = await ctx.supabase.from("idempotency_keys").insert({
        organization_id: ctx.organizationId,
        endpoint: ENDPOINT,
        key: chave,
        request_hash: hashDaColuna(chave),
        response_body: null,
        status_code: null,
        expires_at: new Date(Date.now() + 365 * 86400000).toISOString(),
      });
      if (erroReserva) {
        if (erroReserva.code === "23505") {
          const { data: anterior } = await ctx.supabase
            .from("idempotency_keys")
            .select("response_body")
            .eq("organization_id", ctx.organizationId)
            .eq("endpoint", ENDPOINT)
            .eq("key", chave)
            .maybeSingle();
          const recibo = z
            .object({ criada: z.literal(true), ordem_id: z.string().regex(/^\d{1,20}$/) })
            .safeParse(anterior?.response_body);
          if (recibo.success) return { ...recibo.data, deduplicated: true, agendada: false };
          await revisao(ctx);
        }
        return {
          erro: "os_reserva_indisponivel",
          mensagem:
            "Não foi possível reservar uma nova O.S. com segurança. Confira se já foi criada antes de tentar novamente.",
        };
      }
      reservado = true;
      const ordem = await criarOrdemIxc(e.integracao.baseUrl, e.integracao.token, {
        clienteId: e.cliente.id,
        contratoId: e.contrato.id,
        filialId: e.contrato.id_filial,
        ...ids,
        resumo: input.summary,
      });
      ordemConfirmada = ordem.id;
      const monitorAtivo = await acompanharOrdemIxc(ctx.supabase, {
        organizationId: ctx.organizationId,
        conversationId: ctx.conversationIdDoTurno,
        contactId: ctx.contatoDoTurno!,
        customerId: e.cliente.id,
        contractId: e.contrato.id,
        orderId: ordem.id,
        estado: { status: "A" },
      });
      const resultado = {
        criada: true,
        ordem_id: ordem.id,
        agendada: false,
        acompanhamento_ativo: monitorAtivo,
        mensagem:
          "O IXC confirmou a criação da O.S. A equipe precisa confirmar o agendamento; não prometa dia ou horário. Informe o número e mantenha a demanda acompanhável.",
      };
      const { error: erroRecibo } = await ctx.supabase
        .from("idempotency_keys")
        .update({ response_body: resultado, status_code: 200 })
        .eq("organization_id", ctx.organizationId)
        .eq("endpoint", ENDPOINT)
        .eq("key", chave);
      if (erroRecibo) await revisao(ctx);
      const { error: erroAgenda } = await ctx.supabase.from("agent_inbox_items").insert({
        organization_id: ctx.organizationId,
        kind: "other",
        severity: "info",
        status: "open",
        ref_kind: "conversation",
        ref_id: ctx.conversationIdDoTurno,
        title: `Confirmar agendamento da O.S. ${ordem.id}`,
        body: `O.S. ${ordem.id} criada no IXC para o contrato ${e.contrato.id}. A equipe precisa confirmar a agenda e manter este atendimento atualizado. Nenhum horário foi prometido ao cliente.`,
      });
      await audit({
        action: "ixc.service_order_created",
        organizationId: ctx.organizationId,
        resourceType: "ixc_service_order",
        requestId: ctx.requestId,
        metadata: {
          ordem_id: ordem.id,
          conversation_id: ctx.conversationIdDoTurno,
          contract_id: e.contrato.id,
          reason: input.reason,
        },
      });
      return {
        ...resultado,
        acompanhamento_registrado: !erroAgenda,
        ...(erroAgenda
          ? {
              proximo_passo:
                "A O.S. foi criada, mas o acompanhamento não foi registrado no CRM. Encaminhe ao humano com o número da O.S.; não crie outra.",
            }
          : {}),
      };
    } catch (error) {
      if (ordemConfirmada) {
        const registrado = await revisao(ctx);
        return {
          criada: true,
          ordem_id: ordemConfirmada,
          agendada: false,
          acompanhamento_registrado: false,
          revisao_registrada: registrado,
          mensagem:
            "O IXC confirmou a criação, mas o registro local não foi concluído. Encaminhe ao humano com o número da O.S.; não abra outra.",
        };
      }
      if (!reservado) return falha(error);
      const registrado = await revisao(ctx);
      return {
        erro: "os_em_revisao",
        revisao_registrada: registrado,
        mensagem:
          "A criação pode ter ocorrido, mas o resultado ficou incerto. Não abra outra O.S. nem afirme sucesso. Encaminhe para conferência humana no IXC.",
      };
    }
  },
};
