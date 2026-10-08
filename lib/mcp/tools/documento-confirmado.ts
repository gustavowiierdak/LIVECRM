import { hashCpf, normalizeCpf } from "@/lib/contacts/cpf";
import { samePhone } from "@/lib/channels/phone-variants";
import { sessaoTransportaWhatsapp } from "@/lib/channels/sessao-transporta-whatsapp";
import { buscarClienteIxc } from "@/lib/ixc/client";
import { carregarIntegracaoIxc } from "@/lib/ixc/integration";

import type { McpContext } from "../types";

export type DocumentoConfirmado =
  { ok: true; document: string } | { ok: false; resposta: { erro: string; mensagem: string } };

function telefoneBrasileiro(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const digitos = valor.replace(/\D/g, "");
  if (/^\d{2}[6-9]\d{7,8}$/.test(digitos)) return `+55${digitos}`;
  if (/^55\d{2}[6-9]\d{7,8}$/.test(digitos)) return `+${digitos}`;
  return null;
}

const RECUSA_IDENTIDADE = {
  ok: false as const,
  resposta: {
    erro: "cpf_nao_confirmado",
    mensagem:
      "Não foi possível confirmar o documento e o número deste atendimento com segurança. Encaminhe ao atendimento humano sem consultar ou enviar faturas.",
  },
};

/**
 * Só aceita CPF já associado ao contato ou CPF cujo celular/WhatsApp no IXC
 * coincide com a identidade numérica da conversa recebida pelo canal.
 * A checagem externa é efêmera: não grava CPF informado no chat no cadastro.
 */
export async function confirmarDocumentoDoTurno(
  ctx: McpContext,
  informado: string,
): Promise<DocumentoConfirmado> {
  if (!ctx.contatoDoTurno) {
    return {
      ok: false,
      resposta: {
        erro: "sem_contato_do_turno",
        mensagem: "esta operação só pode ser feita dentro da conversa do próprio cliente.",
      },
    };
  }
  const documento = normalizeCpf(informado);
  if (documento.length !== 11) {
    return {
      ok: false,
      resposta: {
        erro: "documento_invalido",
        mensagem: "informe um CPF válido para esta consulta.",
      },
    };
  }
  const { data: contato } = await ctx.supabase
    .from("contacts")
    .select("cpf_hash,wa_identity")
    .eq("organization_id", ctx.organizationId)
    .eq("id", ctx.contatoDoTurno)
    .maybeSingle<{ cpf_hash: string | null; wa_identity: string | null }>();
  if (!contato) return RECUSA_IDENTIDADE;
  if (contato.cpf_hash && hashCpf(documento) !== contato.cpf_hash) {
    return {
      ok: false,
      resposta: {
        erro: "cpf_nao_confere",
        mensagem: "o CPF informado não coincide com o documento confirmado deste contato.",
      },
    };
  }
  if (!contato.cpf_hash) {
    // Só o contexto real de turno pode acionar a confirmação por telefone;
    // um caller MCP externo não escolhe a identidade do atendimento.
    if (!ctx.sourceJobId || !ctx.conversationIdDoTurno || !contato.wa_identity?.startsWith("phone:")) {
      return RECUSA_IDENTIDADE;
    }
    // `contacts.source` registra o primeiro cadastro: um contato importado
    // continua com essa origem depois de conversar pelo WhatsApp. A prova do
    // canal precisa vir da conversa que acordou ESTE job, não dessa coluna.
    const { data: conversa } = await ctx.supabase
      .from("conversations")
      .select("contact_id,channel_session_id")
      .eq("organization_id", ctx.organizationId)
      .eq("id", ctx.conversationIdDoTurno)
      .maybeSingle<{ contact_id: string; channel_session_id: string | null }>();
    if (conversa?.contact_id !== ctx.contatoDoTurno || !conversa.channel_session_id) {
      return RECUSA_IDENTIDADE;
    }
    const { data: sessao } = await ctx.supabase
      .from("channel_sessions")
      .select("provider")
      .eq("organization_id", ctx.organizationId)
      .eq("id", conversa.channel_session_id)
      .maybeSingle<{ provider: string }>();
    if (!sessaoTransportaWhatsapp(sessao?.provider)) return RECUSA_IDENTIDADE;
    const numeroDaConversa = telefoneBrasileiro(contato.wa_identity.slice("phone:".length));
    if (!numeroDaConversa) return RECUSA_IDENTIDADE;
    const integracao = await carregarIntegracaoIxc(ctx.supabase, ctx.organizationId, "customers");
    if (!integracao.ok) return RECUSA_IDENTIDADE;
    try {
      const cliente = await buscarClienteIxc(integracao.baseUrl, integracao.token, documento);
      if (!cliente) return RECUSA_IDENTIDADE;
      const telefones = [cliente.whatsapp, cliente.telefone_celular]
        .map(telefoneBrasileiro)
        .filter((numero): numero is string => !!numero);
      if (!telefones.some((numero) => samePhone(numero, numeroDaConversa))) return RECUSA_IDENTIDADE;
    } catch {
      return RECUSA_IDENTIDADE;
    }
  }
  return { ok: true, document: documento };
}
