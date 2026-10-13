import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

/**
 * Regressão do reset que parava em `conversations` depois de já apagar `messages`.
 * O atendimento web possui três FKs RESTRICT para a conversa e duas para o
 * contato. O teste usa o mesmo grafo em duas organizações e executa a ordem
 * real das raízes; a vizinha deve permanecer inteira.
 */
const container = process.env.TEST_DB_CONTAINER;
if (!container) throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db`");

function sql(script: string): string {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container!,
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
    { input: script, encoding: "utf8" },
  ).trim();
}

const ACTOR = "95000000-0000-4000-8000-000000000099";

function semear(sufixo: "1" | "2") {
  const id = (tipo: string) => `95000000-${tipo}-4000-8000-00000000000${sufixo}`;
  const org = id("0000");
  const canal = id("1111");
  const contato = id("2222");
  const conversa = id("3333");
  const handoff = id("4444");
  const sessao = id("5555");
  const mensagem = id("6666");
  const msgCanonica = id("7777");
  const digest = sufixo === "1" ? "a".repeat(64) : "b".repeat(64);

  sql(`
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${org}', 'zona-web-${sufixo}', 'Zona web ${sufixo}', 'Zona web ${sufixo}');
    insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
      values ('${canal}', '${org}', 'zona-web-${sufixo}', '\\x00'::bytea);
    insert into public.contacts (id, organization_id, display_name)
      values ('${contato}', '${org}', 'Cliente web ${sufixo}');
    insert into public.conversations (id, organization_id, contact_id, channel_session_id)
      values ('${conversa}', '${org}', '${contato}', '${canal}');
    insert into public.webchat_handoffs
      (id, organization_id, source_conversation_id, source_channel_session_id, contact_id,
       sector, token_digest, expires_at, issued_by)
      values ('${handoff}', '${org}', '${conversa}', '${canal}', '${contato}',
              'suporte', '${digest}', now() + interval '1 hour', '${ACTOR}');
    insert into public.webchat_visitor_sessions
      (id, handoff_id, organization_id, contact_id, source_conversation_id,
       sector, session_digest, csrf_digest, expires_at)
      values ('${sessao}', '${handoff}', '${org}', '${contato}', '${conversa}',
              'suporte', '${digest}', '${digest}', now() + interval '1 hour');
    insert into public.webchat_messages
      (id, organization_id, visitor_session_id, source_conversation_id,
       direction, body, idempotency_key)
      values ('${mensagem}', '${org}', '${sessao}', '${conversa}',
              'visitor', 'olá pelo web', '${mensagem}');
    insert into public.messages
      (id, organization_id, conversation_id, channel_session_id, contact_id,
       type, direction, body)
      values ('${msgCanonica}', '${org}', '${conversa}', '${canal}', '${contato}',
              'text', 'inbound', 'olá pelo web');
  `);
  return org;
}

function contar(org: string, tabela: string): number {
  return Number(sql(`select count(*) from public.${tabela} where organization_id = '${org}';`));
}

describe("zona de perigo inclui as dependências do atendimento web", () => {
  it("a ordem antiga falha; a nova zera a organização sem tocar na vizinha", () => {
    sql(`insert into auth.users (id, email) values ('${ACTOR}', 'zona-web@invariant.test');`);
    const a = semear("1");
    const b = semear("2");

    // Reproduz o estado que a produção atingia: mensagens já apagadas,
    // conversa recusada por FK 23503 e histórico web ainda presente.
    sql(`delete from public.messages where organization_id = '${a}';`);
    try {
      sql(`delete from public.conversations where organization_id = '${a}';`);
      throw new Error("a ordem antiga deveria falhar em conversations");
    } catch (erro) {
      expect(String((erro as { stderr?: Buffer }).stderr)).toContain("foreign key constraint");
    }
    expect(contar(a, "conversations")).toBe(1);
    expect(contar(a, "webchat_messages")).toBe(1);

    for (const tabela of [
      "webchat_messages",
      "webchat_visitor_sessions",
      "webchat_handoffs",
      "messages",
      "conversations",
      "calendar_appointments",
      "orders",
      "crm_proposals",
      "crm_leads",
      "contacts",
    ]) {
      sql(`delete from public.${tabela} where organization_id = '${a}';`);
      expect(contar(a, tabela), `${tabela} sobreviveu ao reset`).toBe(0);
    }
    for (const tabela of [
      "webchat_messages",
      "webchat_visitor_sessions",
      "webchat_handoffs",
      "messages",
      "conversations",
      "contacts",
    ]) {
      expect(contar(b, tabela), `${tabela} da organização vizinha foi apagada`).toBe(1);
    }
  });
});
