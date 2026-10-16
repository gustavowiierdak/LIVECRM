import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";

const container = process.env.TEST_DB_CONTAINER;
if (!container) throw new Error("Rode via pnpm test:db");
const sql = (query: string) =>
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-qtA",
      "-v",
      "ON_ERROR_STOP=1",
      "-f",
      "-",
    ],
    { input: query, encoding: "utf8" },
  ).trim();
const id = (n: number) => `06900000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [org, otherOrg, channel, contact, conv, message, visitor] = Array.from(
  { length: 7 },
  (_, i) => id(i + 1),
);
const config =
  '{"routing":{"ai_inactivity":{"warn_after_minutes":15,"close_after_warning_minutes":15}}}';
const tick = `select public.fn_atendimento_inatividade_tick('${org}');`;
const markSent = `insert into messages(id,organization_id,conversation_id,channel_session_id,contact_id,type,direction,status,body,sent_via,sent_at,metadata)
 select n.id,n.organization_id,n.conversation_id,'${channel}','${contact}','text','outbound','sent',n.body,'automation',now()-interval '16 minutes',
 jsonb_build_object('attendance_notice','inatividade') from attendance_notices n where n.organization_id='${org}' and n.kind='inatividade';`;

beforeAll(() => {
  sql(`insert into organizations(id,slug,legal_name,display_name,settings) values
 ('${org}','idle-a','Teste','Teste','${config}'),('${otherOrg}','idle-b','Outro','Outro','{}');
 insert into auth.users(id,email,raw_user_meta_data) values('${id(8)}','idle@example.invalid','{"full_name":"Teste"}');
 insert into user_organizations(organization_id,user_id,role) values('${org}','${id(8)}','admin');
 insert into channel_sessions(id,organization_id,provider,waha_session_name,webhook_secret_encrypted,status)
 values('${channel}','${org}','webchat',null,'\\x00'::bytea,'WORKING');
 insert into contacts(id,organization_id,display_name,source) values('${contact}','${org}','Cliente','webchat');
 insert into conversations(id,organization_id,contact_id,channel_session_id,channel,status,last_inbound_at)
 values('${conv}','${org}','${contact}','${channel}','whatsapp','open',now()-interval '20 minutes');
 insert into messages(id,organization_id,conversation_id,channel_session_id,contact_id,type,direction,status,body,sent_via,sent_at,created_at)
 values('${message}','${org}','${conv}','${channel}','${contact}','text','outbound','sent','Resposta IA','ai',now()-interval '16 minutes',now()-interval '16 minutes');
 update messages set service_revision=(select service_revision from conversations where id='${conv}') where id='${message}';
 update conversations set bot_silenced_until=null,assignee_kind=null where id='${conv}';`);
});

describe("inatividade da IA — banco real", () => {
  it("não pergunta antes de 15 minutos", () => {
    expect(
      JSON.parse(
        sql(
          `begin; update messages set sent_at=now()-interval '14 minutes' where id='${message}'; ${tick} rollback;`,
        ),
      ),
    ).toEqual({ avisos: 0, encerrados: 0 });
  });
  it("preserva o prazo prometido mesmo que a configuração seja reduzida", () => {
    const r = sql(`begin; ${tick} ${markSent}
      update messages set sent_at=now()-interval '10 minutes' where organization_id='${org}' and metadata->>'attendance_notice'='inatividade';
      update organizations set settings=jsonb_set(settings,'{routing,ai_inactivity,close_after_warning_minutes}','5') where id='${org}';
      ${tick} rollback;`).split("\n");
    expect(JSON.parse(r[1]!)).toEqual({ avisos: 0, encerrados: 0 });
  });
  it("pergunta uma vez e nunca fecha antes do aviso ser enviado", () => {
    const r = sql(`begin; ${tick} ${tick}
      select count(*) from attendance_notices where organization_id='${org}' and kind='inatividade';
      select status from conversations where id='${conv}'; rollback;`).split("\n");
    expect(JSON.parse(r[0]!)).toEqual({ avisos: 1, encerrados: 0 });
    expect(JSON.parse(r[1]!)).toEqual({ avisos: 0, encerrados: 0 });
    expect(r.slice(2)).toEqual(["1", "open"]);
  });
  it("conta os 15 minutos adicionais do envio efetivo e encerra sem afirmar resolução", () => {
    const r = sql(`begin; ${tick} ${markSent}
      update messages set sent_at=now()-interval '14 minutes' where metadata->>'attendance_notice'='inatividade' and organization_id='${org}';
      ${tick}
      update messages set sent_at=now()-interval '16 minutes' where metadata->>'attendance_notice'='inatividade' and organization_id='${org}';
      ${tick}
      select status from conversations where id='${conv}';
      select (body like '%falta de resposta%' and body like '%'||protocol||'%') from attendance_notices where organization_id='${org}' and kind='encerrado';
      rollback;`).split("\n");
    expect(JSON.parse(r[1]!)).toEqual({ avisos: 0, encerrados: 0 });
    expect(JSON.parse(r[2]!)).toEqual({ avisos: 0, encerrados: 1 });
    expect(r.slice(3)).toEqual(["closed", "t"]);
  });
  it.each(["failed", "sending", "queued"])("aviso %s não permite fechamento", (status) => {
    const r = sql(`begin; ${tick} ${markSent}
      update messages set status='${status}' where organization_id='${org}' and metadata->>'attendance_notice'='inatividade';
      ${tick} rollback;`).split("\n");
    expect(JSON.parse(r[1]!)).toEqual({ avisos: 0, encerrados: 0 });
  });
  it("resposta do cliente invalida aviso pendente e cancela fechamento", () => {
    const r = sql(`begin; ${tick} ${markSent}
      update conversations set last_inbound_at=now() where id='${conv}';
      select fn_atendimento_inatividade_aviso_valido('${org}',id) from attendance_notices where organization_id='${org}' and kind='inatividade';
      ${tick} rollback;`).split("\n");
    expect(r[1]).toBe("f");
    expect(JSON.parse(r[2]!)).toEqual({ avisos: 0, encerrados: 0 });
  });
  it.each([
    `update conversations set bot_silenced_until='infinity' where id='${conv}';`,
    `update conversations set assigned_to_user_id='${id(8)}',assignee_kind='user' where id='${conv}';`,
    `update contacts set force_human=true where id='${contact}';`,
    `update contacts set is_blocked=true where id='${contact}';`,
    `update messages set status='failed' where id='${message}';`,
    `update messages set service_revision=999 where id='${message}';`,
    `update organizations set settings='{}' where id='${org}';`,
  ])(
    "não interfere em humano, opt-out, falha, episódio antigo ou política desligada (%s)",
    (change) => {
      expect(JSON.parse(sql(`begin; ${change} ${tick} rollback;`))).toEqual({
        avisos: 0,
        encerrados: 0,
      });
    },
  );
  it("outro tenant não lê nem aciona o atendimento", () => {
    expect(JSON.parse(sql(`select fn_atendimento_inatividade_tick('${otherOrg}');`))).toEqual({
      avisos: 0,
      encerrados: 0,
    });
    expect(
      sql(`select fn_atendimento_inatividade_elegivel('${otherOrg}','${conv}','${message}',1);`),
    ).toBe("f");
    expect(
      sql(`select has_function_privilege('authenticated','fn_atendimento_inatividade_tick(uuid,integer)','execute'),
      has_function_privilege('anon','fn_atendimento_inatividade_aviso_valido(uuid,uuid)','execute');`),
    ).toBe("f|f");
  });
  it("webchat recebe lembrete e aviso final na timeline sem transporte externo", () => {
    const r = sql(`begin; update conversations set channel='webchat' where id='${conv}';
      insert into webchat_visitor_sessions(id,organization_id,contact_id,source_conversation_id,sector,session_digest,csrf_digest,expires_at)
      values('${visitor}','${org}','${contact}','${conv}','suporte',repeat('c',64),repeat('d',64),now()+interval '1 hour');
      ${tick}
      update webchat_messages set created_at=now()-interval '16 minutes' where organization_id='${org}' and metadata->>'attendance_notice'='inatividade';
      ${tick}
      select count(*) from webchat_messages where organization_id='${org}' and metadata->>'attendance_notice' in ('inatividade','encerrado');
      rollback;`).split("\n");
    expect(JSON.parse(r[0]!)).toEqual({ avisos: 1, encerrados: 0 });
    expect(JSON.parse(r[1]!)).toEqual({ avisos: 0, encerrados: 1 });
    expect(r[2]).toBe("2");
  });
});
