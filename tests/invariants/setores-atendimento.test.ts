import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  seedGov,
  GOV_ORG as org,
  GOV_AGENT_A as ana,
  GOV_AGENT_B as bruno,
  GOV_MANAGER as manager,
  GOV_VIEWER as viewer,
  GOV_SESSION as channel,
  GOV_CONV_UNASSIGNED as conv,
} from "./gov-helpers";
import { loadEligibleAttendants } from "@/lib/routing/eligibles";
import { routingPgSupabase } from "../support/routing-pg-supabase";
import { applyRequestHumanHandoff } from "@/lib/agent-engine/agent/human-handoff";

const pool = new Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT}/postgres`,
  max: 5,
});
const q = (sql: string, args: unknown[] = []) => pool.query(sql, args);
let suporte: string;
let cobranca: string;
async function asUser(user: string, sql: string, args: unknown[] = []) {
  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: user, aal: "aal1" }),
    ]);
    const result = await db.query(sql, args);
    await db.query("commit");
    return result;
  } catch (e) {
    await db.query("rollback");
    throw e;
  } finally {
    db.release();
  }
}
const membros = (id: string, users: string[]) =>
  asUser(manager, "select fn_atendimento_salvar_membros($1,$2,$3)", [org, id, users]);
const transferir = (id = suporte) =>
  asUser(manager, "select fn_atendimento_transferir_setor($1,$2,$3,'Luz LOS')", [org, conv, id]);

beforeAll(async () => {
  seedGov();
  await asUser(manager, "select fn_atendimento_criar_setores_padrao($1)", [org]);
  const rows = (await q("select id,slug from atendimento_setores where organization_id=$1", [org]))
    .rows;
  suporte = rows.find((s) => s.slug === "suporte-tecnico").id;
  cobranca = rows.find((s) => s.slug === "cobranca").id;
});
afterAll(() => pool.end());
beforeEach(async () => {
  await q(
    "update user_organizations set revoked_at=null,role='agent' where organization_id=$1 and user_id=any($2)",
    [org, [ana, bruno]],
  );
  await q(
    "update conversations set assigned_to_user_id=null,assignee_kind=null,status='open',atendimento_setor_id=null where organization_id=$1",
    [org],
  );
  await q("delete from channel_routing_policies where organization_id=$1", [org]);
  await q("delete from atendimento_setor_membros where organization_id=$1", [org]);
  await q(
    "insert into attendant_availability(organization_id,user_id,is_available,capacity,schedule) select $1,u,true,10,'{}' from unnest($2::uuid[]) u on conflict(organization_id,user_id) do update set is_available=true,capacity=10,schedule='{}'",
    [org, [ana, bruno]],
  );
});

describe("setores reais e fila humana", () => {
  it("ferramenta real da IA encaminha ao setor com contexto e pausa o automático", async () => {
    const contact = (
      await q("select contact_id from conversations where id=$1 and organization_id=$2", [
        conv,
        org,
      ])
    ).rows[0].contact_id;
    const log = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as Parameters<
      typeof applyRequestHumanHandoff
    >[2]["log"];
    const result = await applyRequestHumanHandoff(
      pool,
      { tenantId: org, leadId: contact, conversationId: conv },
      {
        conversationSummary: "Cliente confirmou luz LOS vermelha.",
        avisoAoLead: { avisado: true },
        log,
      },
      {
        setor: "suporte-tecnico",
        por_que: "Cliente confirmou luz LOS vermelha.",
        cliente_quer: "Restabelecer a conexão",
      },
    );
    expect(result.ok).toBe(true);
    expect(
      (
        await q("select atendimento_setor_id,status,assignee_kind from conversations where id=$1", [
          conv,
        ])
      ).rows[0],
    ).toMatchObject({ atendimento_setor_id: suporte, status: "pending", assignee_kind: null });
    expect(
      (
        await q(
          "select * from passagens_de_atendimento where organization_id=$1 and conversation_id=$2",
          [org, conv],
        )
      ).rowCount,
    ).toBeGreaterThan(0);
  });
  it("criação é idempotente e não vincula pessoas sem escolha", async () => {
    await asUser(manager, "select fn_atendimento_criar_setores_padrao($1)", [org]);
    expect(
      (
        await q("select nome from atendimento_setores where organization_id=$1 order by nome", [
          org,
        ])
      ).rows.map((s) => s.nome),
    ).toEqual(["Agendamento", "Cobrança", "Comercial", "SAC", "Suporte Técnico"]);
    expect(
      (await q("select * from atendimento_setor_membros where organization_id=$1", [org])).rowCount,
    ).toBe(0);
  });
  it("transferência pausa IA, conserva atendimento aberto e gera fila/evento durável", async () => {
    await transferir();
    expect(
      (
        await q(
          "select atendimento_setor_id,status,assigned_to_user_id,bot_silenced_until::text from conversations where id=$1",
          [conv],
        )
      ).rows[0],
    ).toMatchObject({
      atendimento_setor_id: suporte,
      status: "pending",
      assigned_to_user_id: null,
      bot_silenced_until: "infinity",
    });
    expect(
      (
        await q(
          "select * from event_log where organization_id=$1 and event_type='conversation.routing_requested' and payload->>'conversation_id'=$2",
          [org, conv],
        )
      ).rowCount,
    ).toBeGreaterThan(0);
  });
  it("setor vazio não recebe atendente de outro setor; vínculo permite assumir", async () => {
    await membros(cobranca, [ana]);
    await transferir();
    const claim = () =>
      q("select fn_channel_routing_claim($1,$2,$3,$4,'{}') r", [org, conv, channel, ana]);
    expect((await claim()).rows[0].r).toBe("candidate_not_allowed");
    await membros(suporte, [ana]);
    expect((await claim()).rows[0].r).toBe("assigned");
  });
  it("carregador real faz interseção entre canal, setor e pessoas ativas", async () => {
    await membros(suporte, [ana]);
    await membros(cobranca, [bruno]);
    await asUser(manager, "select fn_set_channel_routing($1,$2,$3,false)", [
      org,
      channel,
      [ana, bruno],
    ]);
    const scope = {
      kind: "conversation_channel" as const,
      channelSessionId: channel,
      setorId: suporte,
    };
    const db = routingPgSupabase(pool);
    expect(
      (await loadEligibleAttendants(db.client, org, new Date(), scope)).map((c) => c.userId),
    ).toEqual([ana]);
    await membros(suporte, []);
    expect(await loadEligibleAttendants(db.client, org, new Date(), scope)).toEqual([]);
  });
  it("viewer não configura nem transfere; tentativa inválida preserva membros", async () => {
    await membros(suporte, [ana]);
    await expect(
      asUser(viewer, "select fn_atendimento_salvar_membros($1,$2,$3)", [org, suporte, [bruno]]),
    ).rejects.toThrow();
    await expect(
      asUser(viewer, "select fn_atendimento_transferir_setor($1,$2,$3)", [org, conv, suporte]),
    ).rejects.toThrow();
    await expect(membros(suporte, [viewer])).rejects.toThrow("membro_invalido");
    expect(
      (
        await q(
          "select user_id from atendimento_setor_membros where organization_id=$1 and setor_id=$2",
          [org, suporte],
        )
      ).rows,
    ).toEqual([{ user_id: ana }]);
  });
  it("outro tenant não lê nem muda vínculos; FK não aceita destino cruzado", async () => {
    const other = "d6550000-0000-4000-8000-000000000001",
      user = "d6550000-0000-4000-8000-000000000002";
    await q(
      "insert into organizations(id,slug,legal_name,display_name) values($1,'setores-other','Outra','Outra') on conflict do nothing",
      [other],
    );
    await q(
      "insert into auth.users(id,email) values($1,'setores-other@invariant.test') on conflict do nothing",
      [user],
    );
    await q(
      "insert into user_organizations(organization_id,user_id,role,accepted_at) values($1,$2,'admin',now()) on conflict do nothing",
      [other, user],
    );
    expect(
      (await asUser(user, "select * from atendimento_setores where organization_id=$1", [org]))
        .rowCount,
    ).toBe(0);
    await expect(
      asUser(user, "select fn_atendimento_criar_setores_padrao($1)", [org]),
    ).rejects.toThrow();
    await expect(
      asUser(user, "select fn_atendimento_salvar_membros($1,$2,$3)", [org, suporte, [user]]),
    ).rejects.toThrow();
    await expect(
      q(
        "insert into atendimento_setor_membros(organization_id,setor_id,user_id) values($1,$2,$3)",
        [other, suporte, user],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });
});
