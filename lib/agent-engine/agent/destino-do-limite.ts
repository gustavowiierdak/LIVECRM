import type pg from "pg";

/**
 * O setor do atendimento é a fonte da verdade. Só quando a conversa ainda não
 * tem setor (ex.: canal sem escolha inicial) usamos o assunto declarado pela IA
 * como fallback. Ausência de configuração nunca impede a passagem: cai na fila
 * geral e o aviso crítico continua visível na Central.
 */
const SETOR_POR_ASSUNTO: Readonly<Record<string, string>> = {
  agendamento: "agendamento",
  financeiro: "cobranca",
  problema: "suporte-tecnico",
  acesso: "suporte-tecnico",
  duvida: "sac",
  suporte: "suporte-tecnico",
  "suporte tecnico": "suporte-tecnico",
  "sem conexao": "suporte-tecnico",
  lentidao: "suporte-tecnico",
  cobranca: "cobranca",
  comercial: "comercial",
};

function slugDoAssunto(assunto: string | null | undefined): string | undefined {
  const normalizado = (assunto ?? "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "").trim();
  return SETOR_POR_ASSUNTO[normalizado];
}

export async function destinoDoLimiteDaAutomacao(
  db: Pick<pg.Pool, "query">,
  organizationId: string,
  conversationId: string,
  assunto: string | undefined,
): Promise<{ setorId?: string; setorNome?: string }> {
  const atual = await db.query<{ id: string | null; nome: string | null; active_intent: string | null }>(
    `select s.id, s.nome, c.active_intent from conversations c
       left join atendimento_setores s on s.organization_id=c.organization_id
        and s.id=c.atendimento_setor_id
      where c.organization_id=$1 and c.id=$2`,
    [organizationId, conversationId],
  );
  if (atual.rows[0]?.id && atual.rows[0]?.nome) {
    return { setorId: atual.rows[0].id, setorNome: atual.rows[0].nome };
  }

  // "oi" numa demanda recém-aberta ainda não revela setor. Não herdar o SAC
  // do atendimento anterior nem transformar falha do provedor em classificação.
  const slug = slugDoAssunto(assunto) ?? slugDoAssunto(atual.rows[0]?.active_intent);
  if (!slug) return {};
  const fallback = await db.query<{ id: string; nome: string }>(
    "select id, nome from atendimento_setores where organization_id=$1 and slug=$2",
    [organizationId, slug],
  );
  return fallback.rows[0]
    ? { setorId: fallback.rows[0].id, setorNome: fallback.rows[0].nome }
    : {};
}
