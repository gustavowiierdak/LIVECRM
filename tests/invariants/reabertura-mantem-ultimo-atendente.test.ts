import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GOV_AGENT_A, GOV_ORG, GOV_SESSION, seedGov } from "./gov-helpers";

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 3,
});

beforeAll(() => seedGov());
afterAll(async () => pool.end());

/**
 * O ajuste por empresa "a conversa fica com quem atendeu" (migration 0396),
 * gravado no MESMO caminho que a tela grava (`settings.routing`). O valor é
 * jsonb cru de propósito: o banco só liga com o booleano `true`.
 */
async function ajuste(valor: "true" | "false" | '"true"' | null) {
  await pool.query(
    `update organizations
        set settings = case
          when $2::jsonb is null then coalesce(settings, '{}'::jsonb) #- '{routing,conversation_stays_with_attendant}'
          else jsonb_set(coalesce(settings, '{}'::jsonb), '{routing}',
                 coalesce(settings->'routing', '{}'::jsonb)
                   || jsonb_build_object('conversation_stays_with_attendant', $2::jsonb))
        end
      where id = $1`,
    [GOV_ORG, valor],
  );
}

async function closeWithOwner(
  owner: string | null,
  terminal: "closed" | "resolved" | "archived" = "closed",
) {
  const contact = randomUUID();
  const conversation = randomUUID();
  await pool.query(
    "insert into contacts(id,organization_id,display_name) values($1,$2,'Reabertura')",
    [contact, GOV_ORG],
  );
  await pool.query(
    "insert into conversations(id,organization_id,contact_id,channel_session_id,status) values($1,$2,$3,$4,'open')",
    [conversation, GOV_ORG, contact, GOV_SESSION],
  );
  if (owner) {
    const claim = await pool.query(
      "select id from fn_conversation_assign($1,$2,$3,'claim',null,true)",
      [GOV_ORG, conversation, owner],
    );
    expect(claim.rows).toHaveLength(1);
  }
  const closed = (
    await pool.query("select * from fn_service_status($1,$2,$3,null)", [
      GOV_ORG,
      conversation,
      terminal,
    ])
  ).rows[0];
  return { contact, conversation, closed };
}

async function receive(contact: string, conversation: string) {
  const message = randomUUID();
  await pool.query(
    `insert into messages
      (id,organization_id,conversation_id,channel_session_id,contact_id,type,direction,status,sent_via,body,sent_at)
     values($1,$2,$3,$4,$5,'text','inbound','received','ai','Nova mensagem',clock_timestamp())`,
    [message, GOV_ORG, conversation, GOV_SESSION, contact],
  );
  return message;
}

async function reopened(conversation: string) {
  return (
    await pool.query(
      `select c.status,c.assigned_to_user_id,c.assigned_to_user_name,c.assignee_kind,
              c.bot_silenced_until::text bot_silenced_until,c.service_revision,c.current_demanda_id,
              c.atendimento_setor_id,c.last_handoff_at,c.last_handoff_reason,
              c.active_ai_agent_id,c.active_intent,p.force_human,
              d.dono_kind,d.dono_user_id,
              public.fn_comando_da_conversa(c.status,c.assigned_to_user_id,c.bot_silenced_until,
                false,false,clock_timestamp()) comando
         from conversations c join contacts p on p.id=c.contact_id
           left join demandas d on d.id=c.current_demanda_id
        where c.id=$1 and c.organization_id=$2`,
      [conversation, GOV_ORG],
    )
  ).rows[0];
}

describe("nova mensagem após encerrar atendimento, com o ajuste LIGADO", () => {
  beforeAll(() => ajuste("true"));
  afterAll(() => ajuste(null));

  it.each(["closed", "resolved", "archived"] as const)(
    "mantém o último atendente em Meu após %s sem reativar a automação",
    async (terminal) => {
      const { contact, conversation, closed } = await closeWithOwner(GOV_AGENT_A, terminal);
      const message = await receive(contact, conversation);
      const current = await reopened(conversation);
      expect(current).toMatchObject({
        status: "claimed",
        assigned_to_user_id: GOV_AGENT_A,
        assignee_kind: "user",
        dono_kind: "humano",
        dono_user_id: GOV_AGENT_A,
        comando: "humano",
      });
      expect(current.bot_silenced_until).toBe("infinity");
      expect(Number(current.service_revision)).toBe(Number(closed.service_revision) + 1);
      expect(current.current_demanda_id).not.toBe(closed.current_demanda_id);
      const stamped = await pool.query("select service_revision from messages where id=$1", [
        message,
      ]);
      expect(Number(stamped.rows[0].service_revision)).toBe(Number(current.service_revision));
    },
  );

  it("continua na fila quando o atendimento encerrado não tinha responsável", async () => {
    const { contact, conversation } = await closeWithOwner(null);
    await receive(contact, conversation);
    expect(await reopened(conversation)).toMatchObject({
      status: "open",
      assigned_to_user_id: null,
      assigned_to_user_name: null,
      dono_kind: "ia",
      dono_user_id: null,
    });
  });

  it("não conserva um responsável que perdeu o acesso à organização", async () => {
    const former = randomUUID();
    await pool.query("insert into auth.users(id,email) values($1,$2)", [
      former,
      `${former}@invariant.test`,
    ]);
    await pool.query(
      "insert into user_organizations(user_id,organization_id,role,accepted_at) values($1,$2,'agent',now())",
      [former, GOV_ORG],
    );
    const { contact, conversation } = await closeWithOwner(former);
    await pool.query(
      "update user_organizations set revoked_at=clock_timestamp() where user_id=$1 and organization_id=$2",
      [former, GOV_ORG],
    );
    await receive(contact, conversation);
    expect(await reopened(conversation)).toMatchObject({
      status: "open",
      assigned_to_user_id: null,
      assignee_kind: null,
      dono_kind: "ia",
      dono_user_id: null,
    });
  });
});

/**
 * O PADRÃO — e o de toda empresa que já existia antes da 0396. É a garantia de
 * não regredir ninguém: sem o ajuste, a conversa reaberta não conserva o dono.
 * A trava e o setor do episódio encerrado também precisam sair para que a IA
 * realmente volte a fazer a triagem (não só pareça estar de volta na tela).
 */
describe("nova mensagem após encerrar atendimento, com o ajuste DESLIGADO", () => {
  it.each([
    ["ausente", null],
    ["false", "false"],
    ["texto \"true\" (não é booleano)", '"true"'],
  ] as const)("volta para a fila com o ajuste %s", async (_nome, valor) => {
    await ajuste(valor);
    const { contact, conversation, closed } = await closeWithOwner(GOV_AGENT_A);
    await receive(contact, conversation);
    const current = await reopened(conversation);
    expect(current).toMatchObject({
      status: "open",
      assigned_to_user_id: null,
      assignee_kind: null,
      dono_kind: "ia",
      dono_user_id: null,
    });
    expect(current.bot_silenced_until).toBeNull();
    expect(Number(current.service_revision)).toBe(Number(closed.service_revision) + 1);
  });

  it("novo oi após passagem para Cobrança reinicia IA e setor, sem herdar a fila antiga", async () => {
    await ajuste("false");
    const setor = randomUUID();
    await pool.query(
      "insert into atendimento_setores(id,organization_id,slug,nome) values($1,$2,$3,'Cobrança')",
      [setor, GOV_ORG, `cobranca-${setor.slice(0, 8)}`],
    );
    const { contact, conversation, closed } = await closeWithOwner(null);
    await pool.query("update contacts set force_human=true where id=$1", [contact]);
    await pool.query(
      `update conversations set atendimento_setor_id=$2, bot_silenced_until='infinity',
         active_intent='cobranca',last_handoff_at=clock_timestamp(), last_handoff_reason='caso_escalado'
       where id=$1`,
      [conversation, setor],
    );
    await receive(contact, conversation);
    const current = await reopened(conversation);
    expect(current).toMatchObject({
      status: "open",
      assignee_kind: null,
      bot_silenced_until: null,
      atendimento_setor_id: null,
      last_handoff_at: null,
      last_handoff_reason: null,
      active_intent: null,
      force_human: false,
      dono_kind: "ia",
    });
    expect(Number(current.service_revision)).toBe(Number(closed.service_revision) + 1);
  });

  it("não desfaz uma recusa explícita de atendimento automatizado", async () => {
    await ajuste("false");
    const { contact, conversation } = await closeWithOwner(null);
    await pool.query(
      `update contacts set force_human=true,
         consent=jsonb_build_object('automated_service',jsonb_build_object('declined_at',now()))
       where id=$1`,
      [contact],
    );
    await pool.query(
      `update conversations set bot_silenced_until='infinity',last_handoff_at=clock_timestamp(),
         last_handoff_reason='caso_escalado' where id=$1`,
      [conversation],
    );
    await receive(contact, conversation);
    expect(await reopened(conversation)).toMatchObject({ force_human: true, status: "open" });
  });

  it("não solta a trava global se outra conversa do contato ainda está com humano", async () => {
    await ajuste("false");
    const { contact, conversation } = await closeWithOwner(null);
    const otherSession = randomUUID();
    await pool.query(
      `insert into channel_sessions(id,organization_id,waha_session_name,webhook_secret_encrypted)
       values($1,$2,$3,'\\x00'::bytea)`,
      [otherSession, GOV_ORG, `outro-${otherSession}`],
    );
    await pool.query(
      `insert into conversations(id,organization_id,contact_id,channel_session_id,status,bot_silenced_until)
       values($1,$2,$3,$4,'pending','infinity')`,
      [randomUUID(), GOV_ORG, contact, otherSession],
    );
    await pool.query("update contacts set force_human=true where id=$1", [contact]);
    await pool.query(
      `update conversations set bot_silenced_until='infinity',last_handoff_at=clock_timestamp(),
         last_handoff_reason='caso_escalado' where id=$1`,
      [conversation],
    );
    await receive(contact, conversation);
    expect(await reopened(conversation)).toMatchObject({ force_human: true, status: "open" });
  });

  it("preserva a pausa explícita #off mesmo após novo protocolo", async () => {
    await ajuste("false");
    const { contact, conversation } = await closeWithOwner(null);
    await pool.query(
      `update conversations set bot_silenced_until='infinity',last_handoff_at=clock_timestamp(),
         last_handoff_reason='Comando #off enviado pelo celular' where id=$1`,
      [conversation],
    );
    await receive(contact, conversation);
    expect(await reopened(conversation)).toMatchObject({
      bot_silenced_until: "infinity",
      last_handoff_reason: "Comando #off enviado pelo celular",
    });
  });

  it("não religa IA enquanto o bloqueio por teto de gasto continua ativo", async () => {
    await ajuste("false");
    const { contact, conversation } = await closeWithOwner(null);
    await pool.query("update contacts set force_human=true where id=$1", [contact]);
    await pool.query(
      `update conversations set bot_silenced_until='infinity',last_handoff_at=clock_timestamp(),
         last_handoff_reason='orcamento_de_ia' where id=$1`,
      [conversation],
    );
    await receive(contact, conversation);
    expect(await reopened(conversation)).toMatchObject({
      force_human: true,
      bot_silenced_until: "infinity",
      last_handoff_reason: "orcamento_de_ia",
    });
  });
});
