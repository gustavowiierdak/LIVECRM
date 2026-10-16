import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";

const container = process.env.TEST_DB_CONTAINER;
if (!container) throw new Error("Rode via pnpm test:db");
const sql = (query: string) => execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-qtA", "-v", "ON_ERROR_STOP=1", "-f", "-"], { input: query, encoding: "utf8" }).trim();
const id = (n: number) => `06580000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [org, otherOrg, user, channel, otherChannel, contact, otherContact, conv, otherConv, session, anotherSession, otherSession, original, another, foreign, otherSessionMessage, system] = Array.from({ length: 17 }, (_, n) => id(n + 1)) as [string,string,string,string,string,string,string,string,string,string,string,string,string,string,string,string,string];
const call = (reply: string, key = id(100)) => `public.fn_responder_mensagem_webchat_operador('${org}','${conv}','${session}','Resposta com citação','${key}','${user}','${reply}')`;

beforeAll(() => {
  sql(`
    insert into organizations (id,slug,legal_name,display_name) values
      ('${org}','quote-0658-a','Teste A','Teste A'),('${otherOrg}','quote-0658-b','Teste B','Teste B');
    insert into auth.users (id,email,raw_user_meta_data) values ('${user}','quote@example.invalid','{"full_name":"Ana Souza"}');
    insert into user_organizations (organization_id,user_id,role) values ('${org}','${user}','agent');
    insert into channel_sessions (id,organization_id,provider,waha_session_name,webhook_secret_encrypted,status) values
      ('${channel}','${org}','webchat',null,'\\x00'::bytea,'WORKING'),
      ('${otherChannel}','${otherOrg}','webchat',null,'\\x00'::bytea,'WORKING');
    insert into contacts (id,organization_id,display_name,source,force_human) values
      ('${contact}','${org}','Cliente A','webchat',false),('${otherContact}','${otherOrg}','Cliente B','webchat',false);
    insert into conversations (id,organization_id,contact_id,channel_session_id,channel,status) values
      ('${conv}','${org}','${contact}','${channel}','webchat','open'),
      ('${otherConv}','${otherOrg}','${otherContact}','${otherChannel}','webchat','open');
    insert into webchat_channel_configs (organization_id,channel_session_id,enabled,allowed_sectors,allowed_origins) values
      ('${org}','${channel}',true,array['suporte'],array['https://example.invalid']),
      ('${otherOrg}','${otherChannel}',true,array['suporte'],array['https://example.invalid']);
    insert into webchat_visitor_sessions (id,organization_id,contact_id,source_conversation_id,sector,session_digest,csrf_digest,expires_at) values
      ('${session}','${org}','${contact}','${conv}','suporte',repeat('a',64),repeat('b',64),now()+interval '1 hour'),
      ('${anotherSession}','${org}','${contact}','${conv}','suporte',repeat('c',64),repeat('d',64),now()+interval '1 hour'),
      ('${otherSession}','${otherOrg}','${otherContact}','${otherConv}','suporte',repeat('e',64),repeat('f',64),now()+interval '1 hour');
    insert into webchat_messages (id,organization_id,visitor_session_id,source_conversation_id,direction,body,idempotency_key,sent_by_user_id) values
      ('${original}','${org}','${session}','${conv}','visitor','A luz LOS está vermelha','${id(50)}',null),
      ('${another}','${org}','${session}','${conv}','operator','Vou verificar','${id(51)}','${user}'),
      ('${foreign}','${otherOrg}','${otherSession}','${otherConv}','visitor','Segredo de outro cliente','${id(52)}',null),
      ('${otherSessionMessage}','${org}','${anotherSession}','${conv}','visitor','Outra sessão','${id(53)}',null),
      ('${system}','${org}','${session}','${conv}','system','Registro interno','${id(54)}',null);
  `);
});

describe("resposta citada web atômica e isolada", () => {
  it("persiste a citação resolvida pelo banco e devolve a mesma após retry", () => {
    const first = JSON.parse(sql(`select ${call(original)};`));
    expect(first).toMatchObject({ ok: true, message: { body: "Resposta com citação", reply_to: { id: original, body: "A luz LOS está vermelha", direction: "visitor" } } });
    const repeated = JSON.parse(sql(`select ${call(another)};`));
    expect(repeated.message).toEqual(first.message);
    expect(sql(`select count(*) from webchat_messages where visitor_session_id='${session}' and idempotency_key='${id(100)}';`)).toBe("1");
    expect(JSON.parse(sql(`select metadata->'webchat_reply' from webchat_messages where id='${first.message.id}';`))).toEqual(first.message.reply_to);
  });
  it("resolve o nome do atendente da mensagem original", () => {
    const result = JSON.parse(sql(`select ${call(another, id(101))};`));
    expect(result.message.reply_to.sender_name).toBe("Ana Souza");
  });
  it.each([foreign, otherSessionMessage, system, id(999)])("recusa referência inválida %s sem criar mensagem", (messageId) => {
    const before = sql(`select count(*) from webchat_messages where visitor_session_id='${session}';`);
    expect(JSON.parse(sql(`select ${call(messageId, id(102))};`))).toEqual({ ok: false, reason: "invalid_reply" });
    expect(sql(`select count(*) from webchat_messages where visitor_session_id='${session}';`)).toBe(before);
  });
  it("não envia quando o atendimento já está encerrado", () => {
    const result = sql(`begin; update conversations set status='closed' where id='${conv}'; select ${call(original,id(103))}; rollback;`);
    expect(JSON.parse(result)).toMatchObject({ ok: false, reason: "conversation_closed" });
  });
  it("a RPC só pode ser chamada pela camada de serviço", () => {
    const signature = 'public.fn_responder_mensagem_webchat_operador(uuid,uuid,uuid,text,uuid,uuid,uuid)';
    expect(sql(`select has_function_privilege('anon','${signature}','execute'),has_function_privilege('authenticated','${signature}','execute'),has_function_privilege('service_role','${signature}','execute');`)).toBe("f|f|t");
  });
  it("anonimização remove também o trecho copiado na citação", () => {
    expect(sql(`begin; update contacts set is_anonymized=true,anonymized_at=now() where id='${contact}'; select count(*) from webchat_messages where organization_id='${org}' and metadata ? 'webchat_reply'; rollback;`)).toBe("0");
  });
});
