import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { encerrarConversaAposOs } from "@/lib/agent-engine/agent/encerramento-apos-os";

if (!process.env.TEST_DB_CONTAINER) throw new Error("Use scripts/test-db.sh para banco efêmero.");
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 3,
});
afterAll(async () => {
  await pool.end();
});

async function cenario(texto = "sim, voltou") {
  const [org, contact, channel, conv, watch, question, inbound, reply, inbox] = Array.from(
    { length: 9 },
    () => randomUUID(),
  ) as [string, string, string, string, string, string, string, string, string];
  await pool.query(
    "insert into organizations(id,slug,legal_name,display_name) values($1,$2,'Teste OS','Teste OS')",
    [org, `os-${org}`],
  );
  await pool.query(
    "insert into contacts(id,organization_id,name,force_human,is_blocked,is_personal) values($1,$2,'Teste',false,false,false)",
    [contact, org],
  );
  await pool.query(
    "insert into channel_sessions(id,organization_id,waha_session_name,status,webhook_secret_encrypted) values($1,$2,$3,'WORKING','\\x00'::bytea)",
    [channel, org, `os-${channel}`],
  );
  await pool.query(
    "insert into conversations(id,organization_id,contact_id,channel_session_id,status) values($1,$2,$3,$4,'open')",
    [conv, org, contact, channel],
  );
  const { rows } = await pool.query("select public.fn_service_boundary($1,$2) as boundary", [
    org,
    conv,
  ]);
  const boundary = rows[0].boundary;
  await pool.query(
    "insert into agent_inbox_items(id,organization_id,kind,severity,status,title) values($1,$2,'other','info','open','Acompanhar OS')",
    [inbox, org],
  );
  await pool.query(
    `insert into ixc_service_order_watches(id,organization_id,contact_id,conversation_id,service_revision,service_boundary,customer_id,contract_id,order_id,state,snapshot,notice_state,last_notice_id,inbox_item_id)
    values($1,$2,$3,$4,$5,$6,'1','2','27','awaiting_confirmation','{"status":"F"}','sent',$7,$8)`,
    [watch, org, contact, conv, boundary.service_revision, boundary, question, inbox],
  );
  for (const m of [
    {
      id: question,
      direction: "outbound",
      body: "A sua internet voltou a funcionar normalmente?",
      metadata: { ixc_order_watch_id: watch, ixc_order_notice: "finalizacao" },
      offset: 3,
    },
    { id: inbound, direction: "inbound", body: texto, metadata: {}, offset: 2 },
    { id: reply, direction: "outbound", body: "Obrigado pelo retorno.", metadata: {}, offset: 1 },
  ])
    await pool.query(
      `insert into messages(id,organization_id,conversation_id,channel_session_id,contact_id,type,direction,body,status,sent_via,metadata,service_revision,created_at,sent_at)
    values($1,$2,$3,$4,$5,'text',$6,$7,'sent',$8,$9,$10,now()-$11*interval '1 minute',now()-$11*interval '1 minute')`,
      [
        m.id,
        org,
        conv,
        channel,
        contact,
        m.direction,
        m.body,
        m.direction === "inbound" ? "system" : "ai",
        m.metadata,
        boundary.service_revision,
        m.offset,
      ],
    );
  return {
    org,
    conv,
    watch,
    inbox,
    question,
    boundary,
    contact,
    input: {
      organizationId: org,
      conversationId: conv,
      inboundMessageId: inbound,
      replyMessageId: reply,
    },
  };
}

describe("O.S. só encerra após confirmação do cliente", () => {
  it("confirmação após a pergunta fecha conversa e resolve pendência", async () => {
    const c = await cenario();
    expect(await encerrarConversaAposOs(pool, c.input)).toBe(true);
    expect(
      (await pool.query("select status from conversations where id=$1", [c.conv])).rows[0].status,
    ).toBe("closed");
    expect(
      (await pool.query("select state from ixc_service_order_watches where id=$1", [c.watch]))
        .rows[0].state,
    ).toBe("resolved");
    expect(
      (await pool.query("select status from agent_inbox_items where id=$1", [c.inbox])).rows[0]
        .status,
    ).toBe("resolved");
  });
  it.each(["obrigado", "não voltou", "sim, mas cai toda hora", ""])(
    "não encerra por %s",
    async (t) => {
      const c = await cenario(t);
      expect(await encerrarConversaAposOs(pool, c.input)).toBe(false);
      expect(
        (await pool.query("select status from conversations where id=$1", [c.conv])).rows[0].status,
      ).toBe("open");
    },
  );
  it("não aceita sim a outra pergunta", async () => {
    const c = await cenario("sim");
    await pool.query("update messages set metadata='{}' where id=$1", [c.question]);
    expect(await encerrarConversaAposOs(pool, c.input)).toBe(false);
  });
  it("não fecha atendimento assumido por humano", async () => {
    const c = await cenario();
    await pool.query("update contacts set force_human=true where id=$1", [c.contact]);
    expect(await encerrarConversaAposOs(pool, c.input)).toBe(false);
  });
  it("outro tenant não encerra a conversa", async () => {
    const c = await cenario();
    expect(await encerrarConversaAposOs(pool, { ...c.input, organizationId: randomUUID() })).toBe(
      false,
    );
  });
  it("aviso sem entrega confirmada não autoriza encerramento", async () => {
    const c = await cenario();
    await pool.query("update ixc_service_order_watches set notice_state='review' where id=$1", [
      c.watch,
    ]);
    expect(await encerrarConversaAposOs(pool, c.input)).toBe(false);
  });
  it("banco rejeita vínculo cruzado mesmo com service-role", async () => {
    const a = await cenario();
    const b = await cenario();
    await expect(
      pool.query("update ixc_service_order_watches set conversation_id=$1 where id=$2", [
        b.conv,
        a.watch,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("anon e authenticated não leem nem escrevem a tabela interna", async () => {
    const { rows } = await pool.query(`select relrowsecurity as rls,
      has_table_privilege('anon','public.ixc_service_order_watches','SELECT,INSERT,UPDATE,DELETE') as anon,
      has_table_privilege('authenticated','public.ixc_service_order_watches','SELECT,INSERT,UPDATE,DELETE') as authenticated
      from pg_class where oid='public.ixc_service_order_watches'::regclass`);
    expect(rows[0]).toEqual({ rls: true, anon: false, authenticated: false });
  });
});
