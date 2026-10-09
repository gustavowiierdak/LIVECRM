import { hashCpf, normalizeCpf } from "@/lib/contacts/cpf";
import { sessaoTransportaWhatsapp } from "@/lib/channels/sessao-transporta-whatsapp";
import { ehSessaoDeAtendimentoWeb } from "@/lib/channels";
import { buscarClienteIxc } from "@/lib/ixc/client";
import { carregarIntegracaoIxc } from "@/lib/ixc/integration";
import { lerVinculoIxc, vincularContatoAoIxc } from "@/lib/ixc/vinculo-do-contato";

import type { McpContext } from "../types";

export type DocumentoConfirmado =
  { ok: true; document: string } | { ok: false; resposta: { erro: string; mensagem: string } };

const RECUSA_IDENTIDADE = {
  ok: false as const,
  resposta: {
    erro: "cpf_nao_confirmado",
    mensagem:
      "Não foi possível confirmar o documento neste atendimento com segurança. Encaminhe ao atendimento humano sem consultar ou enviar faturas.",
  },
};

/**
 * Aceita CPF já associado ao contato ou encontrado exatamente no IXC em um
 * turno real de WhatsApp ou atendimento web. Ao confirmar no IXC, grava o CPF
 * cifrado e o vínculo operacional no próprio contato; a próxima pessoa que
 * atender vê qual cadastro foi usado e pode corrigi-lo pela tela.
 */
export async function confirmarDocumentoDoTurno(
  ctx: McpContext,
  informado: string,
  _finalidade: "cadastro" | "fatura" = "cadastro",
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
    .select("cpf_hash,source_metadata")
    .eq("organization_id", ctx.organizationId)
    .eq("id", ctx.contatoDoTurno)
    .maybeSingle<{ cpf_hash: string | null; source_metadata: Record<string, unknown> | null }>();
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
  const vinculoAtual = lerVinculoIxc(contato.source_metadata);
  if (!contato.cpf_hash) {
    // Só o contexto real de turno pode acionar a confirmação via IXC;
    // um caller MCP externo não escolhe a identidade do atendimento.
    if (!ctx.sourceJobId || !ctx.conversationIdDoTurno) {
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
    const conversaWeb = ehSessaoDeAtendimentoWeb(sessao?.provider);
    if (!conversaWeb && !sessaoTransportaWhatsapp(sessao?.provider)) return RECUSA_IDENTIDADE;
    const integracao = await carregarIntegracaoIxc(ctx.supabase, ctx.organizationId, "customers");
    if (!integracao.ok) return RECUSA_IDENTIDADE;
    try {
      const cliente = await buscarClienteIxc(integracao.baseUrl, integracao.token, documento);
      if (!cliente) return RECUSA_IDENTIDADE;
      const vinculado = await vincularContatoAoIxc(ctx.supabase, {
        organizationId: ctx.organizationId,
        contactId: ctx.contatoDoTurno,
        document: documento,
        cliente,
        origem: "automatico",
        actorAgentId: ctx.actor.type === "ai_agent" ? (ctx.actor.agent_id ?? null) : null,
        requestId: ctx.requestId,
      });
      if (!vinculado.ok && (vinculado.motivo === "vinculo_divergente" || vinculado.motivo === "cpf_divergente")) {
        return RECUSA_IDENTIDADE;
      }
    } catch {
      return RECUSA_IDENTIDADE;
    }
  } else if (!vinculoAtual) {
    // O contato pode ter CPF salvo desde antes desta capacidade. O vínculo é
    // enriquecimento best-effort: uma indisponibilidade do IXC não pode impedir
    // uma operação que já estava autorizada pelo hash local.
    try {
      const integracao = await carregarIntegracaoIxc(ctx.supabase, ctx.organizationId, "customers");
      if (integracao.ok) {
        const cliente = await buscarClienteIxc(integracao.baseUrl, integracao.token, documento);
        if (cliente) {
          await vincularContatoAoIxc(ctx.supabase, {
            organizationId: ctx.organizationId,
            contactId: ctx.contatoDoTurno,
            document: documento,
            cliente,
            origem: "automatico",
            actorAgentId: ctx.actor.type === "ai_agent" ? (ctx.actor.agent_id ?? null) : null,
            requestId: ctx.requestId,
          });
        }
      }
    } catch {
      // O hash local continua sendo a confirmação; tentaremos enriquecer no
      // próximo atendimento em vez de derrubar a operação atual.
    }
  }
  return { ok: true, document: documento };
}
