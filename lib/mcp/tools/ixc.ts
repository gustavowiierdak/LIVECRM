/** Consultas e desbloqueio de confiança IXC, sempre presos ao cliente deste turno. */
import { createHash } from "node:crypto";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { hashDaColuna, hashLido } from "@/lib/api/idempotency";
import {
  buscarClienteIxc,
  desbloquearConfiancaIxc,
  IxcConnectionError,
  listarContratosIxc,
} from "@/lib/ixc/client";
import { carregarIntegracaoIxc } from "@/lib/ixc/integration";
import {
  elegibilidadeDesbloqueioConfiancaIxc,
  situacaoDoContratoIxc,
} from "@/lib/ixc/situacao-do-contrato";
import { logger } from "@/lib/logger";

import { confirmarDocumentoDoTurno } from "./documento-confirmado";

import type { McpToolDefinition } from "../types";

const ENDPOINT_DESBLOQUEIO = "mcp:crm_request_ixc_trust_unlock";
const TITULO_REVISAO_DESBLOQUEIO = "Desbloqueio de confiança precisa de revisão";

const inputShape = {
  document: z
    .string()
    .trim()
    .min(11)
    .max(18)
    .describe("CPF informado no atendimento e validado pelo cadastro ou pelo número da conversa."),
};

function mensagemIntegracao(reason: string) {
  switch (reason) {
    case "not_configured":
      return "a integração IXC ainda não foi configurada pela empresa.";
    case "disabled":
      return "a integração IXC está desativada.";
    case "resource_disabled":
      return "a consulta necessária não foi autorizada na conexão IXC.";
    default:
      return "as credenciais do IXC não estão disponíveis; um administrador precisa salvá-las novamente.";
  }
}

function falhaIxc(error: unknown) {
  return {
    erro: "ixc_indisponivel",
    mensagem:
      error instanceof IxcConnectionError
        ? error.message
        : "não foi possível consultar o IXC agora.",
  };
}

function motivoDoVazio(resultado: unknown) {
  if (!resultado || typeof resultado !== "object") return null;
  const r = resultado as { erro?: unknown; encontrado?: unknown; total?: unknown };
  if (typeof r.erro === "string") return r.erro;
  if (r.encontrado === false) return "cliente_nao_encontrado";
  return r.total === 0 ? "nenhum_contrato" : null;
}

function hashRequest(input: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function normalizarFrase(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Aceita só resposta afirmativa curta e inequívoca do turno atual. */
export function autorizacaoInequivocaParaDesbloqueio(frase: string): boolean {
  const normalizada = normalizarFrase(frase);
  const aceitas = new Set([
    "sim",
    "sim por favor",
    "sim pode",
    "sim pode fazer",
    "sim pode desbloquear",
    "sim pode fazer o desbloqueio",
    "sim pode fazer o desbloqueio de confianca",
    "sim faca",
    "sim faca o desbloqueio",
    "sim quero",
    "pode",
    "pode fazer",
    "pode desbloquear",
    "pode fazer o desbloqueio",
    "pode fazer o desbloqueio de confianca",
    "quero",
    "quero sim",
    "quero o desbloqueio",
    "quero o desbloqueio de confianca",
    "autorizo",
    "autorizo o desbloqueio",
    "autorizo o desbloqueio de confianca",
  ]);
  return aceitas.has(normalizada);
}

interface MensagemDeConfirmacao {
  direction: string;
  sent_via: string | null;
  body: string | null;
  media_derived_text: string | null;
  created_at: string;
}

async function confirmarAutorizacaoDoTurno(
  ctx: Parameters<typeof confirmarDocumentoDoTurno>[0],
  conversationId: string,
  fraseInformada: string,
): Promise<{ ok: true } | { ok: false; resposta: Record<string, unknown> }> {
  const { data, error } = await ctx.supabase
    .from("messages")
    .select("direction,sent_via,body,media_derived_text,created_at")
    .eq("organization_id", ctx.organizationId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) {
    return {
      ok: false,
      resposta: {
        erro: "confirmacao_indisponivel",
        mensagem: "não foi possível conferir a confirmação do cliente agora.",
      },
    };
  }
  const mensagens = (data ?? []) as MensagemDeConfirmacao[];
  const recebidas = mensagens.filter((m) => m.direction === "inbound");
  const ultima = recebidas.at(-1);
  if (!ultima) {
    return {
      ok: false,
      resposta: {
        erro: "confirmacao_ausente",
        mensagem: "pergunte ao cliente se ele quer o desbloqueio e aguarde a resposta.",
      },
    };
  }
  const textoRecebido = (
    ultima.body?.trim() ? ultima.body : (ultima.media_derived_text ?? "")
  ).trim();
  const pergunta = mensagens
    .filter(
      (m) => m.direction === "outbound" && m.sent_via === "ai" && m.created_at < ultima.created_at,
    )
    .at(-1);
  const perguntaNormalizada = normalizarFrase(pergunta?.body ?? "");
  if (!perguntaNormalizada.includes("desbloqueio") || !perguntaNormalizada.includes("confianca")) {
    return {
      ok: false,
      resposta: {
        erro: "confirmacao_sem_pergunta",
        mensagem:
          "explique o desbloqueio de confiança, pergunte se o cliente quer fazê-lo e aguarde a resposta.",
      },
    };
  }
  if (
    normalizarFrase(fraseInformada) !== normalizarFrase(textoRecebido) ||
    !autorizacaoInequivocaParaDesbloqueio(textoRecebido)
  ) {
    return {
      ok: false,
      resposta: {
        erro: "confirmacao_nao_inequivoca",
        mensagem:
          "a última resposta do cliente não autoriza claramente o desbloqueio; peça uma confirmação com sim ou não.",
      },
    };
  }
  return { ok: true };
}

async function avisarRevisaoDoDesbloqueio(
  ctx: Parameters<typeof confirmarDocumentoDoTurno>[0],
  conversationId: string,
): Promise<void> {
  try {
    const { data: aberto } = await ctx.supabase
      .from("agent_inbox_items")
      .select("id")
      .eq("organization_id", ctx.organizationId)
      .eq("kind", "other")
      .eq("ref_kind", "conversation")
      .eq("ref_id", conversationId)
      .eq("status", "open")
      .eq("title", TITULO_REVISAO_DESBLOQUEIO)
      .limit(1)
      .maybeSingle();
    if (aberto) return;
    await ctx.supabase.from("agent_inbox_items").insert({
      organization_id: ctx.organizationId,
      kind: "other",
      severity: "warn",
      title: TITULO_REVISAO_DESBLOQUEIO,
      body: "Confira o contrato no IXC antes de repetir: a tentativa pode ter sido executada sem confirmação local.",
      ref_kind: "conversation",
      ref_id: conversationId,
    });
  } catch {
    logger.warn("[ixc.desbloqueio_confianca] aviso de revisão indisponível", {
      organizationId: ctx.organizationId,
      conversationId,
    });
  }
}

export const crmGetIxcCustomer: McpToolDefinition<typeof inputShape> = {
  name: "crm_get_ixc_customer",
  description:
    "Consulta o cadastro operacional no IXC do cliente desta conversa, após CPF confirmado. " +
    "Não use para faturas, PIX ou boleto: os pagamentos vêm da Bemobi.",
  inputSchema: inputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  redigirParaAuditoria: () => ({ document: "[redigido]" }),
  motivoDoVazio,
  handler: async (input, ctx) => {
    const confirmado = await confirmarDocumentoDoTurno(ctx, input.document);
    if (!confirmado.ok) return confirmado.resposta;
    const integracao = await carregarIntegracaoIxc(ctx.supabase, ctx.organizationId, "customers");
    if (!integracao.ok)
      return { erro: integracao.reason, mensagem: mensagemIntegracao(integracao.reason) };
    try {
      const cliente = await buscarClienteIxc(
        integracao.baseUrl,
        integracao.token,
        confirmado.document,
      );
      if (!cliente) return { encontrado: false, cliente: null };
      return {
        encontrado: true,
        cliente: {
          id: cliente.id,
          nome: cliente.razao ?? cliente.fantasia ?? null,
          nome_fantasia: cliente.fantasia ?? null,
          ativo: cliente.ativo ?? null,
        },
        aviso: "dados externos do IXC; confirme com o cliente antes de agir.",
      };
    } catch (error) {
      return falhaIxc(error);
    }
  },
};

export const crmListIxcContracts: McpToolDefinition<typeof inputShape> = {
  name: "crm_list_ixc_contracts",
  description:
    "Consulta os contratos e a situação de acesso do cliente atual no IXC após CPF confirmado. " +
    "Sempre use antes do diagnóstico técnico quando o cliente disser que está sem internet, " +
    "com acesso bloqueado ou suspenso. O campo bloqueio_financeiro já traduz o código do IXC: " +
    "se for true em contrato ativo, a falta de acesso é financeira e não uma falha técnica. " +
    "Não informe valores nem gere cobranças por esta ferramenta; faturas e meios de pagamento vêm da Bemobi.",
  inputSchema: inputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  redigirParaAuditoria: () => ({ document: "[redigido]" }),
  motivoDoVazio,
  handler: async (input, ctx) => {
    const confirmado = await confirmarDocumentoDoTurno(ctx, input.document);
    if (!confirmado.ok) return confirmado.resposta;
    const integracao = await carregarIntegracaoIxc(ctx.supabase, ctx.organizationId, "customers");
    if (!integracao.ok)
      return { erro: integracao.reason, mensagem: mensagemIntegracao(integracao.reason) };
    const contratos = await carregarIntegracaoIxc(ctx.supabase, ctx.organizationId, "contracts");
    if (!contratos.ok)
      return { erro: contratos.reason, mensagem: mensagemIntegracao(contratos.reason) };
    try {
      const cliente = await buscarClienteIxc(
        integracao.baseUrl,
        integracao.token,
        confirmado.document,
      );
      if (!cliente) return { encontrado: false, total: 0, contratos: [] };
      const encontrados = await listarContratosIxc(contratos.baseUrl, contratos.token, cliente.id);
      const classificados = encontrados.map((contrato) => ({
        contrato,
        acesso: situacaoDoContratoIxc(contrato),
        desbloqueio: elegibilidadeDesbloqueioConfiancaIxc(contrato),
      }));
      const bloqueadosFinanceiro = classificados.filter(({ acesso }) => acesso.bloqueioFinanceiro);
      return {
        encontrado: true,
        cliente_id: cliente.id,
        total: encontrados.length,
        bloqueio_financeiro: bloqueadosFinanceiro.length > 0,
        contratos_bloqueados_financeiro: bloqueadosFinanceiro.length,
        diagnostico:
          bloqueadosFinanceiro.length > 0
            ? "bloqueio_financeiro_confirmado"
            : "sem_bloqueio_financeiro_no_ixc",
        contratos: classificados.map(({ contrato, acesso, desbloqueio }) => ({
          id: contrato.id,
          descricao: contrato.contrato ?? null,
          status: contrato.status ?? null,
          status_internet: contrato.status_internet ?? null,
          situacao_acesso: acesso.situacao,
          bloqueio_financeiro: acesso.bloqueioFinanceiro,
          bloqueio_automatico: contrato.bloqueio_automatico ?? null,
          contrato_suspenso: contrato.contrato_suspenso ?? null,
          desbloqueio_confianca: desbloqueio,
        })),
        aviso:
          bloqueadosFinanceiro.length > 0
            ? "O IXC confirmou bloqueio financeiro em contrato ativo e essa é a causa da falta de acesso. Não conduza testes técnicos. Confira desbloqueio_confianca.disponivel_para_solicitar: se true, ofereça o desbloqueio e aguarde um sim explícito; depois use crm_request_ixc_trust_unlock. Em seguida consulte a Bemobi e envie a fatura vencida."
            : "O IXC não indicou bloqueio financeiro em contrato ativo. Isso não confirma quitação de faturas; apenas libera a continuidade do diagnóstico técnico.",
      };
    } catch (error) {
      return falhaIxc(error);
    }
  },
};

const desbloquearInputShape = {
  conversation_id: z.string().uuid().describe("A conversa deste turno."),
  document: inputShape.document,
  contract_id: z
    .string()
    .regex(/^\d{1,20}$/)
    .describe("ID do contrato devolvido por crm_list_ixc_contracts."),
  confirmation_text: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .describe("Copie exatamente a última mensagem em que o cliente autorizou o desbloqueio."),
  idempotency_key: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("Só para chamadas externas; no turno da IA a chave é gerada pelo sistema."),
};

export const crmRequestIxcTrustUnlock: McpToolDefinition<typeof desbloquearInputShape> = {
  name: "crm_request_ixc_trust_unlock",
  description:
    "Executa no IXC o desbloqueio de confiança do contrato financeiramente bloqueado deste cliente. " +
    "Antes, use crm_list_ixc_contracts e só prossiga quando disponivel_para_solicitar for true. " +
    "Explique que é temporário, pergunte se o cliente quer fazê-lo e aguarde a resposta. " +
    "A ferramenta confere no histórico a pergunta e o sim inequívoco do turno atual; copie essa resposta exatamente em confirmation_text. " +
    "Depois do sucesso, consulte a Bemobi e envie a fatura vencida com crm_send_bemobi_payment.",
  inputSchema: desbloquearInputShape,
  category: "write",
  requiresRole: "ai_operator",
  requiresScope: "mcp:write",
  redigirParaAuditoria: (args) => ({
    ...args,
    document: "[redigido]",
    confirmation_text: "[confirmação conferida no histórico]",
    idempotency_key: "[redigido]",
  }),
  motivoDoVazio: (resultado) => {
    if (!resultado || typeof resultado !== "object") return null;
    const erro = (resultado as { erro?: unknown }).erro;
    return typeof erro === "string" ? erro : null;
  },
  handler: async (input, ctx) => {
    const { data: conversa } = await ctx.supabase
      .from("conversations")
      .select("contact_id")
      .eq("organization_id", ctx.organizationId)
      .eq("id", input.conversation_id)
      .maybeSingle<{ contact_id: string }>();
    if (!conversa || conversa.contact_id !== ctx.contatoDoTurno) {
      return {
        erro: "conversa_fora_do_turno",
        mensagem: "a conversa informada não pertence ao cliente deste turno.",
      };
    }

    const confirmado = await confirmarDocumentoDoTurno(ctx, input.document);
    if (!confirmado.ok) return confirmado.resposta;
    const clientes = await carregarIntegracaoIxc(ctx.supabase, ctx.organizationId, "customers");
    if (!clientes.ok) {
      return { erro: clientes.reason, mensagem: mensagemIntegracao(clientes.reason) };
    }
    const contratos = await carregarIntegracaoIxc(ctx.supabase, ctx.organizationId, "contracts");
    if (!contratos.ok) {
      return { erro: contratos.reason, mensagem: mensagemIntegracao(contratos.reason) };
    }

    let contratoEscolhido;
    try {
      const cliente = await buscarClienteIxc(clientes.baseUrl, clientes.token, confirmado.document);
      if (!cliente) {
        return { erro: "cliente_nao_encontrado", mensagem: "o cliente não foi encontrado no IXC." };
      }
      const encontrados = await listarContratosIxc(contratos.baseUrl, contratos.token, cliente.id);
      contratoEscolhido = encontrados.find((contrato) => contrato.id === input.contract_id);
    } catch (error) {
      return falhaIxc(error);
    }
    if (!contratoEscolhido) {
      return {
        erro: "contrato_fora_do_cliente",
        mensagem: "o contrato escolhido não pertence ao CPF confirmado deste cliente.",
      };
    }
    const elegibilidade = elegibilidadeDesbloqueioConfiancaIxc(contratoEscolhido);
    if (!elegibilidade.disponivel_para_solicitar) {
      return {
        erro: "desbloqueio_indisponivel",
        motivo: elegibilidade.motivo,
        mensagem:
          "o contrato não está elegível para desbloqueio de confiança; informe o motivo e envie a fatura vencida.",
      };
    }
    const autorizacao = await confirmarAutorizacaoDoTurno(
      ctx,
      input.conversation_id,
      input.confirmation_text,
    );
    if (!autorizacao.ok) return autorizacao.resposta;

    const chaveIdempotencia = ctx.sourceJobId
      ? `ixc-trust:${hashRequest({
          job_id: ctx.sourceJobId,
          conversation_id: input.conversation_id,
          contract_id: input.contract_id,
        })}`
      : (input.idempotency_key ?? ctx.idempotencyKey);
    if (!chaveIdempotencia) {
      return {
        erro: "idempotencia_obrigatoria",
        mensagem: "não foi possível reservar o desbloqueio com segurança.",
      };
    }
    const requestHash = hashRequest({
      conversation_id: input.conversation_id,
      contract_id: input.contract_id,
    });
    const { error: reservaErro } = await ctx.supabase.from("idempotency_keys").insert({
      organization_id: ctx.organizationId,
      endpoint: ENDPOINT_DESBLOQUEIO,
      key: chaveIdempotencia,
      request_hash: hashDaColuna(requestHash),
      response_body: null,
      status_code: null,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
    if (reservaErro) {
      if (reservaErro.code !== "23505") {
        return {
          erro: "desbloqueio_indisponivel",
          mensagem: "não foi possível reservar o desbloqueio com segurança.",
        };
      }
      const { data: anterior } = await ctx.supabase
        .from("idempotency_keys")
        .select("request_hash,response_body")
        .eq("organization_id", ctx.organizationId)
        .eq("endpoint", ENDPOINT_DESBLOQUEIO)
        .eq("key", chaveIdempotencia)
        .maybeSingle<{
          request_hash: string;
          response_body: Record<string, unknown> | null;
        }>();
      if (!anterior || hashLido(anterior.request_hash) !== requestHash) {
        return { erro: "chave_em_conflito", mensagem: "esta chave já pertence a outra ação." };
      }
      if (anterior.response_body) return { ...anterior.response_body, deduplicated: true };
      await avisarRevisaoDoDesbloqueio(ctx, input.conversation_id);
      return {
        erro: "desbloqueio_em_revisao",
        mensagem:
          "a tentativa pode estar em processamento; não repita e encaminhe para conferência humana.",
      };
    }

    let resultado;
    try {
      resultado = await desbloquearConfiancaIxc(
        contratos.baseUrl,
        contratos.token,
        input.contract_id,
      );
    } catch {
      await avisarRevisaoDoDesbloqueio(ctx, input.conversation_id);
      return {
        erro: "desbloqueio_em_revisao",
        mensagem:
          "o IXC não confirmou o resultado; não repita e encaminhe para conferência humana.",
      };
    }

    const response = resultado.ok
      ? {
          desbloqueado: true,
          contract_id: input.contract_id,
          mensagem:
            "O IXC confirmou o desbloqueio de confiança. Agora consulte a Bemobi e envie a fatura vencida.",
        }
      : {
          erro: "desbloqueio_recusado",
          desbloqueado: false,
          mensagem: resultado.message,
        };
    const { error: reciboErro } = await ctx.supabase
      .from("idempotency_keys")
      .update({ response_body: response, status_code: resultado.ok ? 200 : 409 })
      .eq("organization_id", ctx.organizationId)
      .eq("endpoint", ENDPOINT_DESBLOQUEIO)
      .eq("key", chaveIdempotencia);
    if (reciboErro) await avisarRevisaoDoDesbloqueio(ctx, input.conversation_id);
    if (resultado.ok) {
      const ator =
        ctx.actor.type === "user"
          ? { actorUserId: ctx.actor.id, actorApiTokenId: null }
          : { actorUserId: null, actorApiTokenId: ctx.apiTokenId };
      await audit({
        action: "ixc.trust_unlock_executed",
        organizationId: ctx.organizationId,
        resourceType: "ixc_contract",
        resourceId: input.contract_id,
        requestId: ctx.requestId,
        ...ator,
        metadata: {
          conversation_id: input.conversation_id,
          actor_type: ctx.actor.type,
          consent_verified_from_latest_inbound: true,
        },
      });
    }
    return response;
  },
};
