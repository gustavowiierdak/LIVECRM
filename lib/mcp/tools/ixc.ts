/** Consultas IXC somente do cliente confirmado neste turno; nenhuma escrita no ERP. */
import { z } from "zod";

import { buscarClienteIxc, IxcConnectionError, listarContratosIxc } from "@/lib/ixc/client";
import { carregarIntegracaoIxc } from "@/lib/ixc/integration";
import { situacaoDoContratoIxc } from "@/lib/ixc/situacao-do-contrato";

import { confirmarDocumentoDoTurno } from "./documento-confirmado";

import type { McpToolDefinition } from "../types";

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
      }));
      const bloqueadosFinanceiro = classificados.filter(
        ({ acesso }) => acesso.bloqueioFinanceiro,
      );
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
        contratos: classificados.map(({ contrato, acesso }) => ({
          id: contrato.id,
          descricao: contrato.contrato ?? null,
          status: contrato.status ?? null,
          status_internet: contrato.status_internet ?? null,
          situacao_acesso: acesso.situacao,
          bloqueio_financeiro: acesso.bloqueioFinanceiro,
          bloqueio_automatico: contrato.bloqueio_automatico ?? null,
          contrato_suspenso: contrato.contrato_suspenso ?? null,
        })),
        aviso:
          bloqueadosFinanceiro.length > 0
            ? "O IXC confirmou bloqueio financeiro em contrato ativo. Informe que essa é a causa da falta de acesso e não conduza testes de falha técnica. Para valores, faturas, pagamento ou prazo de desbloqueio, consulte a Bemobi ou encaminhe ao financeiro."
            : "O IXC não indicou bloqueio financeiro em contrato ativo. Isso não confirma quitação de faturas; apenas libera a continuidade do diagnóstico técnico.",
      };
    } catch (error) {
      return falhaIxc(error);
    }
  },
};
