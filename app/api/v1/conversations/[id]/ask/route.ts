import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { ok, fail } from "@/lib/api/wrappers";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { requestTurnDeps } from "@/lib/agent-engine/agent/request-deps";
import { responderSobreOCaso } from "@/lib/agent-engine/agent/conversa-do-caso";
import { montarSystem, PERSONA_NEUTRA } from "@/lib/agent-engine/agent/conversa-do-caso/contexto";
import {
  montarDadosDoAtendimento,
  temRelatoDoCliente,
  type MensagemDoAtendimento,
} from "@/lib/agent-engine/agent/pergunta-sobre-atendimento";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { traduzir } from "@/lib/i18n/dicionario";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const corpo = z.object({ pergunta: z.string().trim().min(2).max(1000) });
const idSchema = z.string().uuid();

/** Pergunta interna sobre a conversa selecionada; nunca envia mensagem ao cliente. */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const denied = await requireSupportWrite();
  if (denied) return denied;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const id = idSchema.safeParse((await ctx.params).id);
  const input = corpo.safeParse(await req.json().catch(() => null));
  if (!id.success || !input.success)
    return fail("validation_failed", t("Pergunta ou conversa inválida."), 422, { requestId });

  const [usuario, org] = await Promise.all([
    checkRateLimit(`atendimento-pergunta:${authz.user.id}`, 12, 60),
    checkRateLimit(`atendimento-pergunta-org:${authz.org.orgId}`, 60, 60),
  ]);
  if (!usuario.allowed || !org.allowed)
    return fail("rate_limited", t("Muitas perguntas seguidas. Tente em um minuto."), 429, {
      requestId,
      headers: { "Retry-After": "60" },
    });

  try {
    // A leitura visível ao usuário vem do client com RLS. O pool só lê a
    // timeline DEPOIS desse portão, sempre filtrada por organização e conversa.
    const db = await createClient();
    const { data: conversa, error } = await db
      .from("conversations")
      .select("id,contact_id,service_started_at")
      .eq("organization_id", authz.org.orgId)
      .eq("id", id.data)
      .maybeSingle();
    if (error) throw error;
    if (!conversa?.contact_id)
      return fail("not_found", t("Conversa não encontrada."), 404, { requestId });

    const { data: contato, error: contatoErro } = await db
      .from("contacts")
      .select("id,is_anonymized")
      .eq("organization_id", authz.org.orgId)
      .eq("id", conversa.contact_id)
      .maybeSingle();
    if (contatoErro) throw contatoErro;
    if (!contato || contato.is_anonymized)
      return fail(
        "reply_context_unavailable",
        t("Este contato não pode ser consultado pela IA."),
        422,
        {
          requestId,
        },
      );

    const pool = getRequestPool();
    const { rows } = await pool.query<MensagemDoAtendimento>(
      `select direction, type, body, media_derived_text, sent_via, sent_at
         from messages
        where organization_id = $1 and conversation_id = $2
          and sent_at >= coalesce($3::timestamptz, '-infinity'::timestamptz)
          and revoked_at is null
        order by sent_at desc, id desc limit 24`,
      [authz.org.orgId, id.data, conversa.service_started_at],
    );
    const mensagens = rows.reverse();

    // Embedding de uma pergunta genérica sobre o cliente encontra sempre os
    // mesmos documentos da empresa. Sem relato textual, não há base para dizer
    // qual é o problema — e uma foto sem descrição não autoriza um palpite.
    let resposta: string;
    let chamadaId: string | null = null;
    if (!temRelatoDoCliente(mensagens)) {
      resposta = t(
        "Este atendimento ainda não tem relato textual suficiente do cliente. Anexos sem descrição não permitem identificar o problema; peça que ele explique o que está acontecendo.",
      );
    } else {
      const gerada = await responderSobreOCaso(pool, requestTurnDeps().llmCfg, {
        tenantId: authz.org.orgId,
        contactId: conversa.contact_id,
        system:
          montarSystem({ persona: PERSONA_NEUTRA, memoriaDaOrganizacao: null }) +
          "\n\nResponda SOMENTE sobre o atendimento no bloco de dados. " +
          "Não use políticas ou documentos gerais não fornecidos. " +
          "Se a pergunta não puder ser respondida pelo histórico, diga exatamente o que falta. " +
          "Uma imagem sem conteúdo extraído não pode ser interpretada visualmente aqui.",
        blocoDeDados: montarDadosDoAtendimento(mensagens),
        historico: [],
        pergunta: input.data.pergunta,
        persona: { fonte: "padrao_da_organizacao", motivo: "sem_agente" },
      });
      resposta = gerada.texto;
      chamadaId = gerada.callId;
      if (!resposta) throw new Error("resposta_vazia");
    }

    void audit({
      action: "ai.conversation_asked",
      actorUserId: authz.user.id,
      organizationId: authz.org.orgId,
      resourceType: "conversation",
      resourceId: id.data,
      requestId,
      metadata: { llm_call_id: chamadaId, com_relato: temRelatoDoCliente(mensagens) },
    });
    return ok({ resposta, origem: "historico_do_atendimento" }, { requestId });
  } catch (error) {
    logger.error("[atendimento-pergunta] consulta falhou", {
      requestId,
      organizationId: authz.org.orgId,
      conversationId: id.data,
      erro: error instanceof Error ? error.message : String(error),
    });
    return fail("internal_error", t("Não foi possível consultar este atendimento agora."), 503, {
      requestId,
    });
  }
}
