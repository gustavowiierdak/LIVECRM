import { execFileSync } from "node:child_process";

import { beforeAll, describe, expect, it } from "vitest";

/**
 * Canal web privado: as quatro tabelas não são uma nova API PostgREST.
 * O serviço usa somente RPCs com a chave interna; visitante recebe apenas
 * mensagens da própria sessão, nunca a conversa ou o contato de origem.
 */
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

const ORG_A = "05440000-0000-4000-8000-00000000000a";
const ORG_B = "05440000-0000-4000-8000-00000000000b";
const USER_A = "05440000-1111-4000-8000-00000000000a";
const SESSION_A = "05440000-2222-4000-8000-00000000000a";
const SESSION_B = "05440000-2222-4000-8000-00000000000b";
const CONTACT_A = "05440000-3333-4000-8000-00000000000a";
const CONTACT_B = "05440000-3333-4000-8000-00000000000b";
const CONVERSATION_A = "05440000-4444-4000-8000-00000000000a";
const CONVERSATION_B = "05440000-4444-4000-8000-00000000000b";
const TOKEN = "a".repeat(64);
const SESSION = "b".repeat(64);
const CSRF = "c".repeat(64);
const ORIGIN = "https://crm.liveinternet.com.br";

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${USER_A}', 'webchat-a@invariant.test');
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'webchat-0544-a', 'Webchat A', 'Webchat A'),
      ('${ORG_B}', 'webchat-0544-b', 'Webchat B', 'Webchat B');
    insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted) values
      ('${SESSION_A}', '${ORG_A}', 'webchat-0544-a', '\\x00'::bytea),
      ('${SESSION_B}', '${ORG_B}', 'webchat-0544-b', '\\x00'::bytea);
    insert into public.contacts (id, organization_id, display_name) values
      ('${CONTACT_A}', '${ORG_A}', 'Contato A'),
      ('${CONTACT_B}', '${ORG_B}', 'Contato B');
    insert into public.conversations (id, organization_id, contact_id, channel_session_id) values
      ('${CONVERSATION_A}', '${ORG_A}', '${CONTACT_A}', '${SESSION_A}'),
      ('${CONVERSATION_B}', '${ORG_B}', '${CONTACT_B}', '${SESSION_B}');
    insert into public.webchat_channel_configs (organization_id, enabled, allowed_sectors, allowed_origins) values
      ('${ORG_A}', true, array['suporte'], array['${ORIGIN}']),
      ('${ORG_B}', true, array['financeiro'], array['https://outro.example']);
  `);
});

describe("webchat isolado no baseline", () => {
  it("mantém RLS e impede acesso direto às quatro tabelas por anon/authenticated", () => {
    const result = sql(`
      select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = any(array['webchat_channel_configs','webchat_handoffs','webchat_visitor_sessions','webchat_messages'])
        and c.relrowsecurity
        and not has_table_privilege('anon', c.oid, 'SELECT')
        and not has_table_privilege('authenticated', c.oid, 'SELECT')
        and not has_table_privilege('authenticated', c.oid, 'INSERT');
    `);
    expect(result).toBe("4");
    expect(
      sql(`
      select has_table_privilege('service_role', 'public.webchat_channel_configs', 'SELECT')
         and has_table_privilege('service_role', 'public.webchat_channel_configs', 'INSERT')
         and has_table_privilege('service_role', 'public.webchat_channel_configs', 'UPDATE');
    `),
    ).toBe("t");
    for (const role of ["anon", "authenticated"] as const) {
      for (const table of [
        "webchat_channel_configs",
        "webchat_handoffs",
        "webchat_visitor_sessions",
        "webchat_messages",
      ]) {
        expect(() =>
          sql(`begin; set local role ${role}; select count(*) from public.${table};`),
        ).toThrow(/permission denied/);
      }
    }
  });

  it("não expõe nenhuma RPC definer à anon key nem ao usuário autenticado", () => {
    const result = sql(`
      select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'fn_%webchat%'
        and p.prosecdef
        and not has_function_privilege('anon', p.oid, 'EXECUTE')
        and not has_function_privilege('authenticated', p.oid, 'EXECUTE');
    `);
    expect(result).toBe("10");
  });

  it("emite somente para a própria conversa e consome o código uma vez na origem autorizada", () => {
    const wrongOrg = sql(`
      select public.fn_emitir_webchat_handoff('${ORG_A}', '${CONVERSATION_B}', 'suporte', repeat('d',64), '${USER_A}')->>'reason';
    `);
    expect(wrongOrg).toBe("conversation_not_found");
    const issued = JSON.parse(
      sql(`
      select public.fn_emitir_webchat_handoff('${ORG_A}', '${CONVERSATION_A}', 'suporte', '${TOKEN}', '${USER_A}');
    `),
    ) as { ok: boolean };
    expect(issued.ok).toBe(true);
    expect(
      sql(`
      select public.fn_consumir_webchat_handoff('${TOKEN}', '${SESSION}', '${CSRF}', 'https://outro.example')->>'ok';
    `),
    ).toBe("false");
    const consumed = JSON.parse(
      sql(`
      select public.fn_consumir_webchat_handoff('${TOKEN}', '${SESSION}', '${CSRF}', '${ORIGIN}');
    `),
    ) as { ok: boolean; sector: string; expires_at: string };
    expect(consumed).toMatchObject({ ok: true, sector: "suporte" });
    expect(new Date(consumed.expires_at).getTime() - Date.now()).toBeGreaterThan(
      7 * 60 * 60 * 1000,
    );
    expect(consumed).not.toHaveProperty("contact_id");
    expect(consumed).not.toHaveProperty("source_conversation_id");
    expect(
      sql(`
      select public.fn_consumir_webchat_handoff('${TOKEN}', repeat('e',64), repeat('f',64), '${ORIGIN}')->>'ok';
    `),
    ).toBe("false");
  });

  it("a timeline do visitante contém só mensagens deste canal e a RPC do operador filtra a org", () => {
    const result = JSON.parse(
      sql(`
      select public.fn_registrar_mensagem_webchat_visitante(
        '${SESSION}', '${CSRF}', '${ORIGIN}', 'Mensagem web privada',
        '05440000-5555-4000-8000-00000000000a'
      );
    `),
    ) as { ok: boolean };
    expect(result.ok).toBe(true);
    const messages = JSON.parse(
      sql(`
      select public.fn_ler_mensagens_webchat_visitante('${SESSION}', '${ORIGIN}');
    `),
    ) as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ direction: "visitor", body: "Mensagem web privada" });
    expect(messages[0]).not.toHaveProperty("contact_id");
    expect(messages[0]).not.toHaveProperty("source_conversation_id");
    const visitorSessionId = sql(`
      select id from public.webchat_visitor_sessions where session_digest = '${SESSION}';
    `);
    expect(
      sql(`
      select public.fn_ler_mensagens_webchat_operador('${ORG_B}', '${CONVERSATION_B}', '${visitorSessionId}');
    `),
    ).toBe("[]");
    expect(
      sql(`
      select public.fn_ler_mensagens_webchat_visitante('${SESSION}', 'https://outro.example');
    `),
    ).toBe("");
  });

  it("um cliente inicia pelo link e a primeira mensagem já aparece em conversa web na Inbox", () => {
    const publicId = sql(`select public_id from public.webchat_channel_configs where organization_id = '${ORG_A}';`);
    const antes = sql(`select count(*) from public.contacts where organization_id = '${ORG_A}' and source = 'webchat';`);
    expect(sql(`select public.fn_iniciar_webchat_publico('${publicId}', 'https://outro.example',
      'Cliente Novo', 'suporte', 'Preciso de ajuda', repeat('1',64), repeat('2',64),
      '05440000-6666-4000-8000-000000000001')->>'ok';`)).toBe("false");
    expect(sql(`select public.fn_iniciar_webchat_publico('${publicId}', '${ORIGIN}',
      'Cliente Novo', 'financeiro', 'Preciso de ajuda', repeat('1',64), repeat('2',64),
      '05440000-6666-4000-8000-000000000002')->>'ok';`)).toBe("false");
    expect(sql(`select count(*) from public.contacts where organization_id = '${ORG_A}' and source = 'webchat';`)).toBe(antes);
    const started = JSON.parse(sql(`select public.fn_iniciar_webchat_publico('${publicId}', '${ORIGIN}',
      'Cliente Novo', 'suporte', 'Preciso de ajuda', repeat('1',64), repeat('2',64),
      '05440000-6666-4000-8000-000000000003');`)) as {
      ok: boolean; conversation_id: string; organization_id: string; message: { body: string };
    };
    expect(started).toMatchObject({ ok: true, organization_id: ORG_A,
      message: { body: "Preciso de ajuda" } });
    expect(sql(`select c.channel || ':' || s.provider || ':' || ct.name from public.conversations c
      join public.channel_sessions s on s.id = c.channel_session_id
      join public.contacts ct on ct.id = c.contact_id
      where c.id = '${started.conversation_id}' and c.organization_id = '${ORG_A}';`))
      .toBe("webchat:webchat:Cliente Novo");
    expect(sql(`select count(*) from public.messages where conversation_id = '${started.conversation_id}';`)).toBe("0");
    const visitor = JSON.parse(sql(`select public.fn_ler_mensagens_webchat_visitante(repeat('1',64), '${ORIGIN}');`)) as Array<{ body: string }>;
    expect(visitor).toEqual([expect.objectContaining({ body: "Preciso de ajuda" })]);
    expect(sql(`select public.fn_ler_mensagens_webchat_visitante(repeat('1',64), 'https://outro.example');`)).toBe("");
  });

  it("anonimizar o contato redige as mensagens e revoga código e sessão na mesma transação", () => {
    const token = "d".repeat(64);
    const session = "e".repeat(64);
    const csrf = "f".repeat(64);
    expect(
      sql(`
      select public.fn_emitir_webchat_handoff('${ORG_A}', '${CONVERSATION_A}', 'suporte', '${token}', '${USER_A}')->>'ok';
    `),
    ).toBe("true");
    expect(
      sql(`
      select public.fn_consumir_webchat_handoff('${token}', '${session}', '${csrf}', '${ORIGIN}')->>'ok';
    `),
    ).toBe("true");
    expect(
      sql(`
      select public.fn_registrar_mensagem_webchat_visitante('${session}', '${csrf}', '${ORIGIN}', 'CPF 123.456.789-00', '05440000-5555-4000-8000-00000000000b')->>'ok';
    `),
    ).toBe("true");
    expect(
      sql(`
      select public.fn_lgpd_cascade_redact_contact('${ORG_A}', '${CONTACT_A}', null::uuid)->>'already_anonymized';
    `),
    ).toBe("false");
    expect(
      sql(`
      select count(*) from public.webchat_visitor_sessions where contact_id = '${CONTACT_A}' and revoked_at is null;
    `),
    ).toBe("0");
    expect(
      sql(`
      select count(*) from public.webchat_handoffs where contact_id = '${CONTACT_A}' and revoked_at is null;
    `),
    ).toBe("0");
    expect(
      sql(`
      select count(*) from public.webchat_messages m join public.webchat_visitor_sessions s on s.id = m.visitor_session_id
       where s.contact_id = '${CONTACT_A}' and m.body <> '[mensagem anonimizada]';
    `),
    ).toBe("0");
    expect(
      sql(`select public.fn_webchat_sessao_visitante('${session}', '${ORIGIN}')->>'ok';`),
    ).toBe("");
    expect(
      sql(`select public.fn_ler_mensagens_webchat_visitante('${session}', '${ORIGIN}');`),
    ).toBe("");
    expect(
      sql(`
      select public.fn_emitir_webchat_handoff('${ORG_A}', '${CONVERSATION_A}', 'suporte', repeat('9',64), '${USER_A}')->>'reason';
    `),
    ).toBe("contact_unavailable");
  });
});
