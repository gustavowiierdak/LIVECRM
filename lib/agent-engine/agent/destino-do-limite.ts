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
  outro: "sac",
};

export async function destinoDoLimiteDaAutomacao(
  db: Pick<pg.Pool, "query">,
  organizationId: string,
  conversationId: string,
  assunto: string | undefined,
): Promise<{ setorId?: string; setorNome?: string }> {
  const atual = await db.query<{ id: string; nome: string }>(
    `select s.id, s.nome from conversations c
       join atendimento_setores s on s.organization_id=c.organization_id
        and s.id=c.atendimento_setor_id
      where c.organization_id=$1 and c.id=$2`,
    [organizationId, conversationId],
  );
  if (atual.rows[0]) return { setorId: atual.rows[0].id, setorNome: atual.rows[0].nome };

  const slug = SETOR_POR_ASSUNTO[assunto ?? "outro"] ?? SETOR_POR_ASSUNTO.outro;
  const fallback = await db.query<{ id: string; nome: string }>(
    "select id, nome from atendimento_setores where organization_id=$1 and slug=$2",
    [organizationId, slug],
  );
  return fallback.rows[0]
    ? { setorId: fallback.rows[0].id, setorNome: fallback.rows[0].nome }
    : {};
}
