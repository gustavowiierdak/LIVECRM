import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { encerrarConversaAposFatura } from '@/lib/agent-engine/agent/encerramento-apos-fatura';
import { GOV_AGENT_A, GOV_ORG, GOV_SESSION, seedGov } from './gov-helpers';

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
});

interface Cenario {
  conversationId: string;
  inboundMessageId: string;
  replyMessageId: string;
  paymentMessageId: string;
  demandId: string;
}

async function mensagem(
  cenario: { conversationId: string; contactId: string },
  input: { id?: string; direction: 'inbound' | 'outbound'; body: string; status: string; sentAt: Date; metadata?: object },
): Promise<string> {
  const id = input.id ?? randomUUID();
  await pool.query(
    `insert into messages
       (id,organization_id,conversation_id,channel_session_id,contact_id,type,direction,status,sent_via,body,sent_at,metadata)
     values ($1,$2,$3,$4,$5,'text',$6,$7,$8,$9,$10,$11)`,
    [id, GOV_ORG, cenario.conversationId, GOV_SESSION, cenario.contactId,
      input.direction, input.status, input.direction === 'inbound' ? 'external_device' : 'ai',
      input.body, input.sentAt, input.metadata ?? {}],
  );
  await pool.query('select fn_mark_conversation_message($1,$2,$3,$4)', [
    cenario.conversationId, input.direction, input.body, input.sentAt,
  ]);
  return id;
}

async function criarCenario(input: { recibo?: boolean; statusPagamento?: string; statusResposta?: string; agradecimento?: string; outroAssunto?: boolean } = {}): Promise<Cenario> {
  const contactId = randomUUID();
  const conversationId = randomUUID();
  await pool.query('insert into contacts(id,organization_id,display_name) values($1,$2,$3)', [contactId, GOV_ORG, 'Cliente fictício']);
  await pool.query(
    `insert into conversations(id,organization_id,contact_id,channel_session_id,status)
     values($1,$2,$3,$4,'open')`,
    [conversationId, GOV_ORG, contactId, GOV_SESSION],
  );
  const referencia = { conversationId, contactId };
  const inicio = new Date(Date.now() - 120_000);
  await mensagem(referencia, { direction: 'inbound', body: 'quero minha fatura', status: 'received', sentAt: inicio });
  await pool.query(
    `update conversations set status='ai_handling', assignee_kind='ai'
      where organization_id=$1 and id=$2`,
    [GOV_ORG, conversationId],
  );
  const paymentMessageId = await mensagem(referencia, {
    direction: 'outbound', body: 'PIX de teste', status: input.statusPagamento ?? 'sent',
    sentAt: new Date(inicio.getTime() + 30_000),
    metadata: { idempotency_key: `bemobi:${conversationId}` },
  });
  if (input.recibo !== false) {
    await pool.query(
      `insert into idempotency_keys(organization_id,endpoint,key,request_hash,status_code,response_body)
       values($1,'mcp:crm_send_bemobi_payment',$2,decode(repeat('a',64),'hex'),200,$3::jsonb)`,
      [GOV_ORG, `bemobi:${conversationId}`, JSON.stringify({ message_id: paymentMessageId, status: 'sent' })],
    );
  }
  if (input.outroAssunto) {
    await mensagem(referencia, {
      direction: 'inbound', body: 'também preciso de suporte técnico', status: 'received',
      sentAt: new Date(inicio.getTime() + 45_000),
    });
  }
  const inboundMessageId = await mensagem(referencia, {
    direction: 'inbound', body: input.agradecimento ?? 'obrigado', status: 'received',
    sentAt: new Date(inicio.getTime() + 60_000),
  });
  const replyMessageId = await mensagem(referencia, {
    direction: 'outbound', body: 'Por nada! Se precisar, é só chamar.',
    status: input.statusResposta ?? 'sent', sentAt: new Date(inicio.getTime() + 70_000),
  });
  const demanda = await pool.query<{ current_demanda_id: string }>(
    'select current_demanda_id from conversations where organization_id=$1 and id=$2',
    [GOV_ORG, conversationId],
  );
  return { conversationId, inboundMessageId, replyMessageId, paymentMessageId, demandId: demanda.rows[0]!.current_demanda_id };
}

async function tentar(cenario: Cenario): Promise<boolean> {
  return encerrarConversaAposFatura(pool, {
    organizationId: GOV_ORG,
    conversationId: cenario.conversationId,
    inboundMessageId: cenario.inboundMessageId,
    replyMessageId: cenario.replyMessageId,
  });
}

async function status(conversationId: string): Promise<string> {
  const result = await pool.query<{ status: string }>('select status from conversations where organization_id=$1 and id=$2', [GOV_ORG, conversationId]);
  return result.rows[0]!.status;
}

beforeAll(() => seedGov());
afterAll(async () => { await pool.end(); });

describe('encerramento automático depois da fatura', () => {
  it('fecha a conversa sem marcar fatura como paga nem dar desfecho à demanda', async () => {
    const cenario = await criarCenario();
    expect(await tentar(cenario)).toBe(true);
    expect(await status(cenario.conversationId)).toBe('closed');
    const demanda = await pool.query<{ fechada_em: Date | null }>('select fechada_em from demandas where organization_id=$1 and id=$2', [GOV_ORG, cenario.demandId]);
    expect(demanda.rows[0]!.fechada_em).toBeNull();
    const pagamento = await pool.query<{ status: string }>('select status from messages where organization_id=$1 and id=$2', [GOV_ORG, cenario.paymentMessageId]);
    expect(pagamento.rows[0]!.status).toBe('sent');
    expect(await tentar(cenario)).toBe(false);
  });

  it('não fecha sem recibo de envio, entrega ou resposta de cortesia confirmadas', async () => {
    for (const variante of [
      { recibo: false }, { statusPagamento: 'failed' }, { statusResposta: 'queued' },
    ]) {
      const cenario = await criarCenario(variante);
      expect(await tentar(cenario)).toBe(false);
      expect(await status(cenario.conversationId)).toBe('ai_handling');
    }
  });

  it('não fecha uma pergunta, um caso humano ou uma conversa assumida', async () => {
    const pergunta = await criarCenario({ agradecimento: 'obrigado, mas o PIX falhou' });
    expect(await tentar(pergunta)).toBe(false);
    const caso = await criarCenario();
    await pool.query(
      `insert into agent_cases(organization_id,conversation_id,title,summary,blocker)
       values($1,$2,'Teste','Pendente','Pessoa precisa revisar')`,
      [GOV_ORG, caso.conversationId],
    );
    expect(await tentar(caso)).toBe(false);
    const assumida = await criarCenario();
    await pool.query(`update conversations set status='claimed',assignee_kind='user',assigned_to_user_id=$3
      where organization_id=$1 and id=$2`, [GOV_ORG, assumida.conversationId, GOV_AGENT_A]);
    expect(await tentar(assumida)).toBe(false);
  });

  it('não atribui a uma fatura antiga um agradecimento de outro assunto', async () => {
    const cenario = await criarCenario({ outroAssunto: true });
    expect(await tentar(cenario)).toBe(false);
    expect(await status(cenario.conversationId)).toBe('ai_handling');
  });

  it('não fecha se entrou outra mensagem depois do obrigado ou se o atendimento mudou', async () => {
    const nova = await criarCenario();
    const contato = await pool.query<{ contact_id: string }>('select contact_id from conversations where id=$1', [nova.conversationId]);
    await mensagem({ conversationId: nova.conversationId, contactId: contato.rows[0]!.contact_id }, {
      direction: 'inbound', body: 'espera, tenho outra dúvida', status: 'received', sentAt: new Date(),
    });
    expect(await tentar(nova)).toBe(false);
    const mudada = await criarCenario();
    await pool.query('update conversations set service_revision=service_revision+1 where organization_id=$1 and id=$2', [GOV_ORG, mudada.conversationId]);
    expect(await tentar(mudada)).toBe(false);
  });
});
