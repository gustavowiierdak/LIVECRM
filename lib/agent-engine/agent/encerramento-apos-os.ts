import type pg from "pg";
import { confirmouSolucaoIxc } from "@/lib/ixc/aviso-os";

/** Fecha depois da resposta enviada, nunca no momento em que o IXC fecha a O.S. */
export async function encerrarConversaAposOs(
  pool: pg.Pool,
  input: {
    organizationId: string;
    conversationId: string;
    inboundMessageId: string;
    replyMessageId: string;
  },
): Promise<boolean> {
  const db = await pool.connect();
  try {
    await db.query("begin");
    const sair = async () => {
      await db.query("rollback");
      return false;
    };
    const { rows: iniciais } = await db.query<{ contact_id: string }>(
      "select contact_id from conversations where organization_id=$1 and id=$2",
      [input.organizationId, input.conversationId],
    );
    if (!iniciais[0]) return await sair();
    await db.query("select public.fn_service_lock($1,$2)", [
      input.organizationId,
      iniciais[0].contact_id,
    ]);
    const { rows: conversas } = await db.query<{ service_revision: string }>(
      `select c.service_revision from conversations c join contacts p
       on p.id=c.contact_id and p.organization_id=c.organization_id
       where c.organization_id=$1 and c.id=$2 and c.status in ('open','pending','ai_handling')
       and c.assigned_to_user_id is null and (c.assignee_kind is null or c.assignee_kind='ai')
       and not coalesce(p.force_human,false) and not p.is_blocked and not p.is_personal
       and (c.bot_silenced_until is null or c.bot_silenced_until <= now()) for no key update of c`,
      [input.organizationId, input.conversationId],
    );
    if (!conversas[0]) return await sair();
    const { rows: entradas } = await db.query<{
      id: string;
      body: string;
      created_at: Date;
      service_revision: string;
    }>(
      `select id,body,created_at,service_revision from messages where organization_id=$1 and conversation_id=$2
       and direction='inbound' order by created_at desc,id desc limit 1`,
      [input.organizationId, input.conversationId],
    );
    const entrada = entradas[0];
    if (
      !entrada ||
      entrada.id !== input.inboundMessageId ||
      entrada.service_revision !== conversas[0].service_revision ||
      !confirmouSolucaoIxc(entrada.body ?? "")
    )
      return await sair();
    const { rows: perguntas } = await db.query<{ id: string; watch_id: string }>(
      `select id, metadata->>'ixc_order_watch_id' as watch_id from messages
       where organization_id=$1 and conversation_id=$2 and direction='outbound' and created_at < $3
       order by created_at desc,id desc limit 1`,
      [input.organizationId, input.conversationId, entrada.created_at],
    );
    if (!perguntas[0]?.watch_id) return await sair();
    const { rows: watches } = await db.query<{ id: string; inbox_item_id: string | null }>(
      `select w.id,w.inbox_item_id from ixc_service_order_watches w
       where w.organization_id=$1 and w.conversation_id=$2 and w.id::text=$3
       and w.service_revision=$4 and w.state='awaiting_confirmation' and w.notice_state='sent'
       and w.last_notice_id=$5 and w.snapshot->>'status'='F'
       and exists (select 1 from messages r where r.organization_id=$1 and r.conversation_id=$2
         and r.id=$6 and r.direction='outbound' and r.sent_via='ai' and r.service_revision=$4
         and r.status in ('sent','delivered','read') and r.created_at >= $7)
       for update`,
      [
        input.organizationId,
        input.conversationId,
        perguntas[0].watch_id,
        conversas[0].service_revision,
        perguntas[0].id,
        input.replyMessageId,
        entrada.created_at,
      ],
    );
    const watch = watches[0];
    if (!watch) return await sair();
    await db.query(
      "update ixc_service_order_watches set state='resolved' where organization_id=$1 and id=$2",
      [input.organizationId, watch.id],
    );
    if (watch.inbox_item_id)
      await db.query(
        `update agent_inbox_items set status='resolved',resolved_at=now(),body='Cliente confirmou que a conexão voltou após a finalização da O.S.' where organization_id=$1 and id=$2`,
        [input.organizationId, watch.inbox_item_id],
      );
    const { rows: pendentes } = await db.query<{ existe: boolean }>(
      `select exists(select 1 from ixc_service_order_watches where organization_id=$1 and conversation_id=$2
        and service_revision=$3 and state in ('active','awaiting_confirmation'))
       or exists(select 1 from agent_cases where organization_id=$1 and conversation_id=$2
         and status in ('awaiting_human','awaiting_lead','escalated')) as existe`,
      [input.organizationId, input.conversationId, conversas[0].service_revision],
    );
    const podeFechar = pendentes[0]?.existe === false;
    if (podeFechar)
      await db.query("select public.fn_service_status($1,$2,'closed',$3)", [
        input.organizationId,
        input.conversationId,
        conversas[0].service_revision,
      ]);
    await db.query("commit");
    return podeFechar;
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    db.release();
  }
}
