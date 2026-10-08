import type pg from 'pg';

/** Cortesia terminal, não uma pergunta nem um novo pedido disfarçado de agradecimento. */
export function despedidaSimples(texto: string): boolean {
  if (texto.includes('?')) return false;
  const normalizado = texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const obrigado = '(?:muito )?(?:obrigad[oa]|obg|valeu|agradeco)(?: mesmo| pela ajuda)?';
  const despedida = '(?:tchau|ate mais|ate logo|boa noite|bom dia|boa tarde)';
  return new RegExp(`^(?:${obrigado})(?: ${despedida})?$|^era (?:so|apenas) isso(?: ${obrigado})?$`).test(normalizado);
}

interface EncerramentoInput {
  organizationId: string;
  conversationId: string;
  inboundMessageId: string;
  replyMessageId: string;
}

/**
 * Fecha só a conversa (nunca a demanda ou a fatura), depois da resposta de
 * cortesia. A decisão e a transição usam o MESMO lock do ciclo de atendimento:
 * um inbound novo, uma troca para humano ou uma reabertura não podem entrar
 * entre a checagem e o fn_service_status.
 */
export async function encerrarConversaAposFatura(
  pool: pg.Pool,
  input: EncerramentoInput,
): Promise<boolean> {
  const client = await pool.connect();
  let emTransacao = false;
  const naoEncerrar = async (): Promise<false> => {
    await client.query('ROLLBACK');
    emTransacao = false;
    return false;
  };
  try {
    await client.query('BEGIN');
    emTransacao = true;
    const inicial = await client.query<{ contact_id: string }>(
      `select contact_id from conversations where organization_id = $1 and id = $2`,
      [input.organizationId, input.conversationId],
    );
    if (!inicial.rows[0]) return await naoEncerrar();
    await client.query('select public.fn_service_lock($1,$2)', [input.organizationId, inicial.rows[0].contact_id]);

    const atual = await client.query<{
      contact_id: string;
      service_revision: string;
      service_started_at: Date | null;
      status: string;
      assignee_kind: string | null;
      assigned_to_user_id: string | null;
      force_human: boolean;
    }>(
      `select c.contact_id, c.service_revision, c.service_started_at, c.status, c.assignee_kind,
              c.assigned_to_user_id, coalesce(p.force_human, false) as force_human
         from conversations c
         join contacts p on p.id = c.contact_id and p.organization_id = c.organization_id
        where c.organization_id = $1 and c.id = $2
        for no key update of c`,
      [input.organizationId, input.conversationId],
    );
    const conversa = atual.rows[0];
    if (
      !conversa || conversa.contact_id !== inicial.rows[0].contact_id ||
      !['open', 'pending', 'ai_handling'].includes(conversa.status) ||
      (conversa.assignee_kind !== null && conversa.assignee_kind !== 'ai') ||
      conversa.assigned_to_user_id !== null ||
      conversa.force_human || conversa.service_started_at === null
    ) return await naoEncerrar();

    const entrada = await client.query<{
      id: string;
      body: string | null;
      sent_at: Date;
      service_revision: string;
    }>(
      `select id, body, sent_at, service_revision
         from messages
        where organization_id = $1 and conversation_id = $2 and direction = 'inbound'
        order by created_at desc, id desc limit 1`,
      [input.organizationId, input.conversationId],
    );
    const mensagem = entrada.rows[0];
    if (
      !mensagem || mensagem.id !== input.inboundMessageId ||
      mensagem.service_revision !== conversa.service_revision ||
      !despedidaSimples(mensagem.body ?? '')
    ) return await naoEncerrar();

    const comprovacoes = await client.query<{ reply_ok: boolean; fatura_enviada: boolean }>(
      `select
         exists (
           select 1 from messages r
            where r.id = $3 and r.organization_id = $1 and r.conversation_id = $2
              and r.direction = 'outbound' and r.sent_via = 'ai'
              and r.status in ('sent', 'delivered', 'read')
              and r.sent_at >= $4 and r.sent_at >= $5
         ) as reply_ok,
         exists (
           select 1 from messages m
           join idempotency_keys receipt
             on receipt.organization_id = m.organization_id
            and receipt.endpoint = 'mcp:crm_send_bemobi_payment'
            and receipt.key = m.metadata->>'idempotency_key'
            and receipt.status_code = 200
            and receipt.response_body->>'message_id' = m.id::text
            where m.organization_id = $1 and m.conversation_id = $2
              and m.direction = 'outbound' and m.sent_via = 'ai'
              and m.status in ('sent', 'delivered', 'read')
              and m.sent_at >= $5 and m.sent_at < $4
              and not exists (
                select 1 from messages nova_entrada
                 where nova_entrada.organization_id = $1
                   and nova_entrada.conversation_id = $2
                   and nova_entrada.direction = 'inbound'
                   and nova_entrada.sent_at > m.sent_at
                   and nova_entrada.sent_at < $4
              )
              and not exists (
                select 1 from agent_cases ac
                 where ac.organization_id = $1
                   and ac.conversation_id = $2
                   and ac.status in ('awaiting_human', 'awaiting_lead', 'escalated')
                   and ac.opened_at >= m.sent_at
              )
         ) as fatura_enviada`,
      [input.organizationId, input.conversationId, input.replyMessageId, mensagem.sent_at, conversa.service_started_at],
    );
    const prova = comprovacoes.rows[0];
    if (!prova?.reply_ok || !prova.fatura_enviada) return await naoEncerrar();

    await client.query(`select public.fn_service_status($1,$2,'closed',$3)`, [
      input.organizationId, input.conversationId, conversa.service_revision,
    ]);
    await client.query('COMMIT');
    emTransacao = false;
    return true;
  } catch (error) {
    if (emTransacao) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
