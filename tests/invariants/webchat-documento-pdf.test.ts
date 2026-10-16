import { execFileSync } from "node:child_process";

import { beforeAll, describe, expect, it } from "vitest";

const container = process.env.TEST_DB_CONTAINER ?? "";
if (!container) throw new Error("TEST_DB_CONTAINER ausente — rode via pnpm test:db");

function sql(query: string): string {
  return execFileSync(
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
      "-v",
      "ON_ERROR_STOP=1",
      "-tA",
      "-f",
      "-",
    ],
    { input: query, encoding: "utf8" },
  ).trim();
}

const ORG = "06320000-0000-4000-8000-000000000001";
const CHANNEL = "06320000-1000-4000-8000-000000000001";
const CONTACT = "06320000-2000-4000-8000-000000000001";
const CONVERSATION = "06320000-3000-4000-8000-000000000001";
const VISITOR = "06320000-4000-4000-8000-000000000001";
const MESSAGE = "06320000-5000-4000-8000-000000000001";
const IDEMPOTENCY = "06320000-6000-4000-8000-000000000001";
const ORIGIN = "https://crm.liveinternet.com.br";
const SESSION = "a".repeat(64);

beforeAll(() => {
  sql(`
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG}', 'webchat-pdf-0632', 'Webchat PDF', 'Webchat PDF');
    insert into public.channel_sessions
      (id, organization_id, provider, waha_session_name, webhook_secret_encrypted, status)
      values ('${CHANNEL}', '${ORG}', 'webchat', null, '\\x00'::bytea, 'WORKING');
    insert into public.contacts (id, organization_id, display_name, source, force_human)
      values ('${CONTACT}', '${ORG}', 'Cliente PDF', 'webchat', false);
    insert into public.conversations
      (id, organization_id, contact_id, channel_session_id, channel, status)
      values ('${CONVERSATION}', '${ORG}', '${CONTACT}', '${CHANNEL}', 'webchat', 'open');
    insert into public.webchat_channel_configs
      (organization_id, channel_session_id, enabled, allowed_sectors, allowed_origins)
      values ('${ORG}', '${CHANNEL}', true, array['financeiro'], array['${ORIGIN}']);
    insert into public.webchat_visitor_sessions
      (id, organization_id, contact_id, source_conversation_id, sector,
       session_digest, csrf_digest, expires_at)
      values ('${VISITOR}', '${ORG}', '${CONTACT}', '${CONVERSATION}', 'financeiro',
              '${SESSION}', repeat('b', 64), now() + interval '1 hour');
  `);
});

describe("documento PDF no atendimento web", () => {
  it("expõe só o nome do autor da mensagem, com isolamento de organização", () => {
    const ana = "06320000-7000-4000-8000-000000000001";
    const outro = "06320000-7000-4000-8000-000000000002";
    const agente = "06320000-8000-4000-8000-000000000001";
    const externo = "06320000-8000-4000-8000-000000000002";
    const outraOrg = "06320000-0000-4000-8000-000000000002";
    sql(`
      insert into organizations (id,slug,legal_name,display_name)
        values ('${outraOrg}','outro-webchat-0636','Outra','Outra');
      insert into auth.users (id,email,raw_user_meta_data) values
        ('${ana}','ana@example.invalid','{"full_name":"Ana Souza","segredo":"privado"}'),
        ('${outro}','outro@example.invalid','{"full_name":"Pessoa externa"}');
      insert into user_organizations (organization_id,user_id,role) values
        ('${ORG}','${ana}','agent'),('${outraOrg}','${outro}','agent');
      insert into ai_agents (id,organization_id,name,system_prompt) values
        ('${agente}','${ORG}','Suporte Técnico','Teste'),
        ('${externo}','${outraOrg}','Agente externo','Teste');
      insert into webchat_messages
        (organization_id,source_conversation_id,visitor_session_id,direction,body,sent_by_user_id,metadata,idempotency_key)
      values
        ('${ORG}','${CONVERSATION}','${VISITOR}','operator','humano','${ana}','{}',gen_random_uuid()),
        ('${ORG}','${CONVERSATION}','${VISITOR}','operator','externo','${outro}','{}',gen_random_uuid()),
        ('${ORG}','${CONVERSATION}','${VISITOR}','operator','ia',null,'{"ai_actor_id":"${agente}"}',gen_random_uuid()),
        ('${ORG}','${CONVERSATION}','${VISITOR}','operator','ia externa',null,'{"ai_actor_id":"${externo}"}',gen_random_uuid()),
        ('${ORG}','${CONVERSATION}','${VISITOR}','operator','ia legada',null,'{"ai_actor_id":"invalido"}',gen_random_uuid());
    `);
    const mensagens = JSON.parse(sql(`select public.fn_ler_mensagens_webchat_visitante('${SESSION}','${ORIGIN}');`)) as Array<Record<string, unknown>>;
    expect(mensagens.find((m) => m.body === "humano")).toMatchObject({ sender_kind: "human", sender_name: "Ana Souza" });
    expect(mensagens.find((m) => m.body === "externo")).toMatchObject({ sender_kind: "human", sender_name: null });
    expect(mensagens.find((m) => m.body === "ia")).toMatchObject({ sender_kind: "ai", sender_name: "Suporte Técnico" });
    expect(mensagens.find((m) => m.body === "ia externa")).toMatchObject({ sender_name: null });
    expect(mensagens.find((m) => m.body === "ia legada")).toMatchObject({ sender_name: null });
    expect(JSON.stringify(mensagens)).not.toMatch(/example.invalid|privado|Pessoa externa|Agente externo/);
    expect(sql(`select public.fn_ler_mensagens_webchat_visitante('${SESSION}','https://outro.example');`)).toBe("");
    expect(sql(`select has_function_privilege('anon','public.fn_ler_mensagens_webchat_visitante(text,text)','EXECUTE');`)).toBe("f");
  });

  it("espelha o anexo real e publica somente os campos seguros", () => {
    expect(
      JSON.parse(
        sql(`select public.fn_enviar_mensagem_webchat_agente(
          '${ORG}','${CONVERSATION}','${MESSAGE}','${IDEMPOTENCY}',
          'Segunda via da sua fatura.',
          '{"idempotency_key":"pdf-0632","segredo_interno":"nao_publicar","webchat_attachment":{"type":"document","mime":"application/pdf","url":"https://faturas.example/segunda-via.pdf"}}'::jsonb,
          null);`),
      ),
    ).toMatchObject({ ok: true });

    expect(
      sql(`select type || ':' || media_mime || ':' || media_url
        from public.messages where id='${MESSAGE}';`),
    ).toBe("document:application/pdf:https://faturas.example/segunda-via.pdf");

    const publico = JSON.parse(
      sql(`select item from jsonb_array_elements(
        public.fn_ler_mensagens_webchat_visitante('${SESSION}','${ORIGIN}')) item
        where item->>'id'='${MESSAGE}';`),
    ) as Record<string, unknown>;
    expect(publico).toMatchObject({
      type: "document",
      body: "Segunda via da sua fatura.",
      media_url: "https://faturas.example/segunda-via.pdf",
      media_mime: "application/pdf",
    });
    expect(publico).not.toHaveProperty("metadata");
    expect(JSON.stringify(publico)).not.toContain("segredo_interno");
  });

  it("não promove URL insegura nem metadado de visitante a anexo", () => {
    const inseguro = "06320000-5000-4000-8000-000000000002";
    const chave = "06320000-6000-4000-8000-000000000002";
    expect(
      JSON.parse(
        sql(`select public.fn_enviar_mensagem_webchat_agente(
          '${ORG}','${CONVERSATION}','${inseguro}','${chave}',
          'Arquivo indisponível.',
          '{"webchat_attachment":{"type":"document","mime":"application/pdf","url":"http://inseguro.example/fatura.pdf"}}'::jsonb,
          null);`),
      ),
    ).toMatchObject({ ok: true });
    expect(
      sql(
        `select type || ':' || coalesce(media_url, '') from public.messages where id='${inseguro}';`,
      ),
    ).toBe("text:");
    expect(
      sql(`select item->>'type' from jsonb_array_elements(
        public.fn_ler_mensagens_webchat_visitante('${SESSION}','${ORIGIN}')) item
        where item->>'id'='${inseguro}';`),
    ).toBe("text");
  });
});
