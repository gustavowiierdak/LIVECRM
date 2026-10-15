import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
const id = (n: number) => `06800000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [
  org,
  otherOrg,
  user,
  channel,
  otherChannel,
  contact,
  otherContact,
  conv,
  otherConv,
  session,
  externalConv,
] = Array.from({ length: 11 }, (_, n) => id(n + 1));
let protocol: string;

beforeAll(() => {
  sql(`
 insert into organizations(id,slug,legal_name,display_name) values
 ('${org}','proto-a','Teste A','Teste A'),('${otherOrg}','proto-b','Teste B','Teste B');
 insert into auth.users(id,email,raw_user_meta_data) values('${user}','protocol@example.invalid','{"full_name":"Ana Souza"}');
 insert into user_organizations(organization_id,user_id,role) values('${org}','${user}','admin');
 insert into channel_sessions(id,organization_id,provider,waha_session_name,webhook_secret_encrypted,status) values
 ('${channel}','${org}','webchat',null,'\\x00'::bytea,'WORKING'),('${otherChannel}','${otherOrg}','webchat',null,'\\x00'::bytea,'WORKING');
 insert into contacts(id,organization_id,display_name,source) values('${contact}','${org}','Cliente A','webchat'),('${otherContact}','${otherOrg}','Cliente B','webchat'),('${id(12)}','${org}','Cliente externo','webchat');
 insert into conversations(id,organization_id,contact_id,channel_session_id,channel,status) values
 ('${conv}','${org}','${contact}','${channel}','webchat','open'),
 ('${otherConv}','${otherOrg}','${otherContact}','${otherChannel}','webchat','open'),
 ('${externalConv}','${org}','${id(12)}','${channel}','whatsapp','open');
 update conversations set last_inbound_at=now() where id='${externalConv}';
 insert into attendance_notices(id,organization_id,conversation_id,protocol,kind,body)
 select '${id(50)}',organization_id,id,service_protocol,'iniciado','Segredo B' from conversations where id='${otherConv}';
 insert into webchat_visitor_sessions(id,organization_id,contact_id,source_conversation_id,sector,session_digest,csrf_digest,expires_at) values
 ('${session}','${org}','${contact}','${conv}','suporte',repeat('a',64),repeat('b',64),now()+interval '1 hour');
 `);
  protocol = sql(`select service_protocol from conversations where id='${conv}';`);
});

describe("protocolo e avisos do atendimento", () => {
  it("gera identificadores persistentes e distintos e informa o visitante", () => {
    expect(protocol).toMatch(/^\d{8}-\d{6,}$/);
    expect(
      sql(
        `select count(distinct service_protocol) from conversations where id in ('${conv}','${otherConv}','${externalConv}');`,
      ),
    ).toBe("3");
    expect(sql(`select body from webchat_messages where visitor_session_id='${session}';`)).toBe(
      `Seu atendimento foi iniciado. Protocolo: ${protocol}.`,
    );
  });
  it("assumir identifica a pessoa sem trocar o protocolo, e o no-op não repete o aviso", () => {
    const result = sql(`begin;
   update conversations set assigned_to_user_id='${user}',assigned_to_user_name='Ana Souza',status='claimed' where id='${conv}';
   update conversations set assigned_to_user_id='${user}',status='claimed' where id='${conv}';
   select count(*) from webchat_messages where visitor_session_id='${session}' and body like '%Ana Souza%' and body like '%${protocol}%';
   rollback;`);
    expect(result).toBe("1");
  });
  it("fechar informa o mesmo protocolo; arquivar depois não duplica encerramento", () => {
    const result = sql(`begin; update conversations set status='closed' where id='${conv}';
   update conversations set status='archived' where id='${conv}';
   select count(*) from webchat_messages where visitor_session_id='${session}' and metadata->>'attendance_notice'='encerrado' and body like '%${protocol}%'; rollback;`);
    expect(result).toBe("1");
  });
  it("reaplicação do backfill legado não acrescenta outro aviso sem protocolo", () => {
    const baseline = readFileSync("supabase/baseline.sql", "utf8");
    const start = baseline.indexOf("-- Corrige sessoes que ja estavam abertas no navegador");
    expect(start).toBeGreaterThan(-1);
    const end = baseline.indexOf("revoke all on function", start);
    expect(end).toBeGreaterThan(start);
    expect(
      sql(`begin; update conversations set status='closed' where id='${conv}';
   ${baseline.slice(start, end)}
   select count(*) from webchat_messages where visitor_session_id='${session}' and body='Atendimento encerrado pela equipe.'; rollback;`),
    ).toBe("0");
  });
  it("reabrir cria outro protocolo e mantém o registro anterior no histórico", () => {
    const result =
      sql(`begin; update conversations set status='closed' where id='${conv}'; update conversations set status='open' where id='${conv}';
   select (service_protocol <> '${protocol}')::text from conversations where id='${conv}';
   select count(distinct metadata->>'service_protocol') from webchat_messages where visitor_session_id='${session}'; rollback;`);
    expect(result).toBe("true\n2");
  });
  it("alteração comum e tentativa de editar protocolo não mudam sua identidade", () => {
    expect(
      sql(
        `begin; update conversations set service_protocol='FORJADO',status='pending' where id='${conv}'; select service_protocol from conversations where id='${conv}'; rollback;`,
      ),
    ).toBe(protocol);
  });
  it("canal externo grava outbox e evento, sem HTTP no trigger", () => {
    const data = JSON.parse(
      sql(
        `select jsonb_build_object('notice',n.id,'protocol',n.protocol,'event',e.payload->>'notice_id') from attendance_notices n join event_log e on e.entity_id=n.conversation_id and e.event_type='attendance.notice_requested' where n.conversation_id='${externalConv}';`,
      ),
    );
    expect(data.protocol).toMatch(/^\d{8}-\d{6,}$/);
    expect(data.notice).toBe(data.event);
  });
  it("conversa importada vazia não dispara aviso; a primeira mensagem inicia uma única vez", () => {
    expect(
      sql(`begin;
   insert into contacts(id,organization_id,display_name,source) values('${id(17)}','${org}','Contato importado','manual');
   insert into conversations(id,organization_id,contact_id,channel_session_id,channel,status) values('${id(18)}','${org}','${id(17)}','${channel}','whatsapp','open');
   select count(*) from attendance_notices where conversation_id='${id(18)}';
   update conversations set last_inbound_at=clock_timestamp() where id='${id(18)}';
   update conversations set last_inbound_at=clock_timestamp()+interval '1 second' where id='${id(18)}';
   select count(*) from attendance_notices where conversation_id='${id(18)}'; rollback;`),
    ).toBe("0\n1");
  });
  it("a mensagem de encerramento externa não reabre o atendimento", () => {
    expect(
      sql(`begin; update conversations set status='closed' where id='${externalConv}';
   insert into messages(id,organization_id,conversation_id,channel_session_id,contact_id,type,direction,status,body,sent_via,sent_at)
   values('${id(90)}','${org}','${externalConv}','${channel}','${id(12)}','text','outbound','sent','Atendimento encerrado','automation',now());
   select status from conversations where id='${externalConv}'; rollback;`),
    ).toBe("closed");
  });
  it("outbox respeita isolamento entre organizações e não aceita escrita do navegador", () => {
    expect(
      sql(`select count(*) from attendance_notices where organization_id='${otherOrg}';`),
    ).toBe("1");
    const result =
      sql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${user}',true) is not null;
   select count(*) from attendance_notices where organization_id='${otherOrg}'; rollback;`);
    expect(result).toBe("t\n0");
    expect(
      sql(
        `select has_table_privilege('authenticated','attendance_notices','insert'),has_table_privilege('anon','attendance_notices','select');`,
      ),
    ).toBe("f|f");
  });
  it("funções privilegiadas não são RPCs públicas", () => {
    expect(
      sql(
        `select bool_and(not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('fn_novo_protocolo_atendimento','fn_atendimento_definir_protocolo','fn_atendimento_emitir_aviso','fn_webchat_avisar_inicio');`,
      ),
    ).toBe("t");
  });
});
