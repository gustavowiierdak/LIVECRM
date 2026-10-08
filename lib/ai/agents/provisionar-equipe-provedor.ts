import type { SupabaseClient } from "@supabase/supabase-js";

import { escolherModeloNoCatalogo } from "@/lib/ai/agents/escolher-modelo";
import { mcpAgentDraftRecords } from "@/lib/ai/agents/create-draft";
import { IDS_DE_PROVEDOR } from "@/lib/ai/pontos/provedores";

const ORIGEM = "telecom_blueprint_v1";

interface Blueprint {
  key: string;
  name: string;
  description: string;
  priority: number;
  prompt: string;
  tools: string[];
  intent: string;
  intentDescription: string;
  examples: string[];
}

const COMUNS = [
  "crm_get_contact",
  "crm_get_conversation",
  "crm_get_conversation_history",
  "crm_request_human_handoff",
];

/** Só acrescenta ferramentas em rascunhos intactos do blueprint anterior. */
const FERRAMENTAS_ANTERIORES: Record<string, readonly string[]> = {
  financeiro: [...COMUNS, "crm_list_bemobi_invoices"],
  suporte_tecnico: [...COMUNS, "crm_describe_external_data", "crm_query_external_data"],
  relacionamento_contratos: [...COMUNS, "crm_schedule_followup", "crm_update_lead"],
};

function rascunhoIntacto(toolIds: unknown, anteriores: readonly string[]): boolean {
  return (
    Array.isArray(toolIds) &&
    toolIds.length === anteriores.length &&
    new Set(toolIds).size === anteriores.length &&
    toolIds.every((id) => typeof id === "string" && anteriores.includes(id))
  );
}

const BLUEPRINTS: Blueprint[] = [
  {
    key: "recepcao_triagem",
    name: "Recepção e Triagem",
    description:
      "Entende a mensagem livre, separa demandas e direciona para o especialista correto.",
    priority: 100,
    prompt:
      "Você faz a recepção de um provedor de internet. Entenda texto livre e identifique todos os assuntos da mensagem, sem obrigar o cliente a escolher menu. Faça uma pergunta curta somente quando faltar dado essencial. Se houver mais de uma demanda, reconheça cada uma e preserve as pendentes. Não invente informação de contrato, rede ou cobrança. Encaminhe para o especialista adequado e entregue um resumo objetivo do que o cliente pediu, do que já foi confirmado e do próximo passo.",
    tools: COMUNS,
    intent: "triagem",
    intentDescription:
      "Saudação, mensagem ambígua, vários assuntos ou pedido ainda sem categoria clara.",
    examples: [
      "oi",
      "preciso de ajuda",
      "tenho dois problemas",
      "quero falar sobre minha internet",
    ],
  },
  {
    key: "financeiro",
    name: "Financeiro",
    description:
      "Consulta faturas na Bemobi e conduz segunda via, PIX, boleto e dúvidas financeiras.",
    priority: 90,
    prompt:
      "Você cuida do financeiro de um provedor de internet. Use a Bemobi como fonte de faturas e meios de pagamento; use o IXC apenas para cliente, contrato, bloqueio e situação operacional. Nunca invente valor, vencimento, baixa, PIX ou linha digitável. Se o cliente ainda não informou CPF, peça-o uma vez nesta conversa; não o mande para outro canal só por isso. Quando ele informar, chame crm_list_bemobi_invoices: o sistema, não você, verifica o CPF vinculado ao contato ou o número da conversa no IXC. Não peça o CPF novamente se ele já foi informado. Só se a ferramenta recusar a confirmação, pare a consulta e abra um caso humano com o resumo. Se houver várias faturas, confirme qual o cliente deseja. Para enviar, use apenas crm_send_bemobi_payment com a fatura confirmada e o formato solicitado; nunca copie o código financeiro na resposta. Só diga que enviou quando a ferramenta confirmar status enviado; se estiver em fila, diga que o envio está em processamento. Se a ferramenta estiver indisponível ou pedir revisão, abra um caso humano e informe a limitação sem prometer envio.",
    tools: [
      ...COMUNS,
      "crm_get_ixc_customer",
      "crm_list_ixc_contracts",
      "crm_list_bemobi_invoices",
    ],
    intent: "financeiro",
    intentDescription:
      "Fatura, pagamento, PIX, boleto, segunda via, vencimento, negociação ou bloqueio financeiro.",
    examples: [
      "manda o pix",
      "quero a segunda via",
      "minha fatura venceu",
      "já paguei e continuo bloqueado",
    ],
  },
  {
    key: "suporte_tecnico",
    name: "Suporte Técnico",
    description:
      "Diagnostica conexão, orienta testes e decide quando abrir ou escalar atendimento técnico.",
    priority: 80,
    prompt:
      "Você faz suporte técnico de um provedor de internet. Primeiro confirme o sintoma, o alcance e quando começou. Consulte somente fontes conectadas para contrato, equipamento, sinal, incidentes e ordens; nunca simule diagnóstico de rede. Oriente um teste por vez, em linguagem simples, e registre o resultado. Não peça que o cliente repita informação já presente no histórico. Antes de prometer visita ou prazo, confirme disponibilidade na ferramenta. Quando não houver acesso ao dado técnico ou a resolução depender de equipe externa, transfira com resumo dos testes, evidências e próximo passo.",
    tools: [
      ...COMUNS,
      "crm_get_ixc_customer",
      "crm_list_ixc_contracts",
      "crm_describe_external_data",
      "crm_query_external_data",
    ],
    intent: "suporte_tecnico",
    intentDescription:
      "Sem internet, lentidão, queda, Wi-Fi, roteador, cabo, sinal, visita ou ordem de serviço.",
    examples: [
      "estou sem internet",
      "wifi muito lento",
      "a luz do modem está vermelha",
      "preciso de visita técnica",
    ],
  },
  {
    key: "comercial",
    name: "Comercial",
    description: "Atende cobertura, planos, contratação e registra a oportunidade comercial.",
    priority: 70,
    prompt:
      "Você é o especialista comercial de um provedor de internet. Entenda endereço, necessidade e perfil de uso antes de oferecer. Cobertura, plano, preço, taxa e prazo devem vir de fonte configurada; não invente oferta. Registre o interesse no funil e deixe claro o próximo passo. Confirme condições antes de concluir e transfira quando uma aprovação humana for necessária.",
    tools: [
      ...COMUNS,
      "crm_search_products",
      "crm_create_lead",
      "crm_update_lead",
      "crm_move_lead_stage",
    ],
    intent: "comercial",
    intentDescription:
      "Cobertura, plano, preço, contratação, upgrade, indicação ou novo endereço ainda sem contrato.",
    examples: [
      "tem cobertura no meu endereço",
      "quais planos vocês têm",
      "quero contratar",
      "quanto custa 500 mega",
    ],
  },
  {
    key: "relacionamento_contratos",
    name: "Relacionamento e Contratos",
    description: "Cuida de cadastro, mudança, fidelidade, cancelamento, retenção e acompanhamento.",
    priority: 60,
    prompt:
      "Você cuida de relacionamento e contratos de um provedor de internet. Atenda mudança de endereço, alteração cadastral, fidelidade, indicação, cancelamento e retenção. Consulte a fonte oficial antes de afirmar regra contratual. Cancelamento, concessão, desconto e mudança de titularidade exigem confirmação ou intervenção humana; nunca execute por improviso. Registre o motivo real e entregue ao humano um resumo com dados confirmados, pedido, risco e próximo passo. Acompanhe promessas com retorno quando houver prazo.",
    tools: [
      ...COMUNS,
      "crm_get_ixc_customer",
      "crm_list_ixc_contracts",
      "crm_schedule_followup",
      "crm_update_lead",
    ],
    intent: "relacionamento_contratos",
    intentDescription:
      "Cancelamento, mudança de endereço ou titular, fidelidade, cadastro, retenção e acompanhamento.",
    examples: [
      "quero cancelar",
      "vou mudar de endereço",
      "trocar o titular",
      "qual minha fidelidade",
    ],
  },
];

function providerDaOrganizacao(settings: unknown): string {
  const provider = (settings as { llm?: { provider?: unknown } } | null)?.llm?.provider;
  if (typeof provider === "string" && (IDS_DE_PROVEDOR as readonly string[]).includes(provider)) {
    return provider;
  }
  return "anthropic";
}

export interface ProvisionarEquipeResult {
  created: number;
  reused: number;
  routerCreated: boolean;
  total: number;
  model: string;
  provider: string;
}

export async function provisionarEquipeProvedor(
  admin: SupabaseClient,
  input: { organizationId: string; userId: string },
): Promise<ProvisionarEquipeResult> {
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", input.organizationId)
    .single();
  if (orgError || !org) throw new Error("organization_not_found");
  const provider = providerDaOrganizacao(org.settings);
  const escolha = await escolherModeloNoCatalogo(admin, provider);
  if (!escolha?.escolhido) throw new Error("model_not_available");

  const { data: canal } = await admin
    .from("channel_sessions")
    .select("id")
    .eq("organization_id", input.organizationId)
    .is("archived_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string }>();

  const { data: existentes } = await admin
    .from("ai_agents")
    .select("id,name,config")
    .eq("organization_id", input.organizationId);
  const porChave = new Map<string, { id: string; name: string }>();
  for (const agente of existentes ?? []) {
    const config = agente.config as {
      provisioning_origin?: unknown;
      blueprint_key?: unknown;
    } | null;
    if (config?.provisioning_origin === ORIGEM && typeof config.blueprint_key === "string") {
      porChave.set(config.blueprint_key, { id: agente.id, name: agente.name });
    }
  }

  let created = 0;
  let reused = 0;
  const agentes = new Map<string, string>();
  for (const blueprint of BLUEPRINTS) {
    const existente = porChave.get(blueprint.key);
    if (existente) {
      const { data: versaoExistente } = await admin
        .from("ai_agent_versions")
        .select("id,status,tool_ids")
        .eq("organization_id", input.organizationId)
        .eq("agent_id", existente.id)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (versaoExistente) {
        const anteriores = FERRAMENTAS_ANTERIORES[blueprint.key];
        if (
          versaoExistente.status === "draft" &&
          anteriores &&
          rascunhoIntacto(versaoExistente.tool_ids, anteriores)
        ) {
          const { error: toolsError } = await admin
            .from("ai_agent_versions")
            .update({ tool_ids: blueprint.tools })
            .eq("organization_id", input.organizationId)
            .eq("agent_id", existente.id)
            .eq("id", versaoExistente.id)
            .eq("status", "draft");
          if (toolsError)
            throw new Error(`agent_tools_update_failed:${blueprint.key}:${toolsError.code}`);
        }
        await admin
          .from("ai_agents")
          .update({ archived_at: null, is_active: true })
          .eq("organization_id", input.organizationId)
          .eq("id", existente.id);
        agentes.set(blueprint.key, existente.id);
        reused += 1;
        continue;
      }
    }

    const records = mcpAgentDraftRecords(
      { orgId: input.organizationId, userId: input.userId },
      {
        name: blueprint.name,
        description: blueprint.description,
        priority: blueprint.priority,
        version: {
          system_prompt: blueprint.prompt,
          provider,
          model: escolha.modelId,
          credential_id: null,
          tool_ids: blueprint.tools,
          channel_session_id: canal?.id ?? null,
          handoff_tool_enabled: true,
          cases_enabled: true,
          pipeline_ids: [],
          knowledge_source_ids: [],
          followup: { enabled: false, flow_pointer_ids: [], send_window: null },
        },
      },
      existente ? { agentId: existente.id } : {},
    );
    let agent: { id: string } | null = existente ? { id: existente.id } : null;
    if (existente) {
      const { error } = await admin
        .from("ai_agents")
        .update({
          name: records.agent.name,
          description: records.agent.description,
          model: records.agent.model,
          system_prompt: records.agent.system_prompt,
          priority: records.agent.priority,
          is_active: true,
          archived_at: null,
          config: { provisioning_origin: ORIGEM, blueprint_key: blueprint.key },
        })
        .eq("organization_id", input.organizationId)
        .eq("id", existente.id);
      if (error) throw new Error(`agent_recover_failed:${blueprint.key}:${error.message}`);
    } else {
      const { data, error: agentError } = await admin
        .from("ai_agents")
        .insert({
          ...records.agent,
          config: { provisioning_origin: ORIGEM, blueprint_key: blueprint.key },
        })
        .select("id")
        .single<{ id: string }>();
      agent = data;
      if (agentError || !agent) {
        throw new Error(
          `agent_create_failed:${blueprint.key}:${agentError?.code ?? "unknown"}:${agentError?.message ?? "empty"}`,
        );
      }
    }

    const { error: versionError } = await admin.from("ai_agent_versions").insert({
      ...records.version,
    });
    if (versionError || !agent) {
      await admin
        .from("ai_agents")
        .update({ archived_at: new Date().toISOString(), is_active: false })
        .eq("organization_id", input.organizationId)
        .eq("id", records.agent.id);
      throw new Error(
        `agent_version_create_failed:${blueprint.key}:${versionError?.code ?? "unknown"}:${versionError?.message ?? "empty"}`,
      );
    }
    agentes.set(blueprint.key, agent.id);
    created += 1;
  }

  let routerCreated = false;
  if (canal && agentes.size === BLUEPRINTS.length) {
    const { data: routerExistente } = await admin
      .from("ai_routers")
      .select("id")
      .eq("organization_id", input.organizationId)
      .eq("channel_session_id", canal.id)
      .eq("name", "Atendimento provedor")
      .maybeSingle<{ id: string }>();
    let routerId = routerExistente?.id;
    if (!routerId) {
      const { data: router, error } = await admin
        .from("ai_routers")
        .insert({
          organization_id: input.organizationId,
          name: "Atendimento provedor",
          channel_session_id: canal.id,
          is_active: false,
          fallback_agent_id: agentes.get("recepcao_triagem") ?? null,
          config: { sticky: true, min_confidence: 0.65, provisioning_origin: ORIGEM },
          created_by: input.userId,
        })
        .select("id")
        .single<{ id: string }>();
      if (error || !router) throw new Error("router_create_failed");
      routerId = router.id;
      routerCreated = true;
    }

    const { data: membros } = await admin
      .from("ai_router_members")
      .select("intent_name")
      .eq("organization_id", input.organizationId)
      .eq("router_id", routerId);
    const intents = new Set((membros ?? []).map((m) => m.intent_name));
    const faltantes = BLUEPRINTS.filter((blueprint) => !intents.has(blueprint.intent)).map(
      (blueprint, position) => ({
        organization_id: input.organizationId,
        router_id: routerId,
        agent_id: agentes.get(blueprint.key)!,
        intent_name: blueprint.intent,
        intent_description: blueprint.intentDescription,
        examples: blueprint.examples,
        position,
      }),
    );
    if (faltantes.length > 0) {
      const { error } = await admin.from("ai_router_members").insert(faltantes);
      if (error) throw new Error("router_members_create_failed");
    }
  }

  return {
    created,
    reused,
    routerCreated,
    total: BLUEPRINTS.length,
    model: escolha.modelId,
    provider,
  };
}

export const EQUIPE_PROVEDOR_ORIGEM = ORIGEM;
