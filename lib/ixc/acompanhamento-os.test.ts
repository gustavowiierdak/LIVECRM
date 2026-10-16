import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verificarOrdensAcompanhadas } from "./acompanhamento-os";
import { carregarIntegracaoIxc } from "./integration";
import { consultarOrdemIxc } from "./suporte";
import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { readServiceBoundarySupabase } from "@/lib/atendimento/origem";
import { assertOrgOperante } from "@/lib/organizacao/operante";

vi.mock("@/app/api/v1/messages/_handler", () => ({ sendMessageHandler: vi.fn() }));
vi.mock("./integration", () => ({ carregarIntegracaoIxc: vi.fn() }));
vi.mock("./suporte", () => ({ consultarOrdemIxc: vi.fn() }));
vi.mock("@/lib/atendimento/origem", () => ({ readServiceBoundarySupabase: vi.fn() }));
vi.mock("@/lib/atendimento/fronteira-server", () => ({ currentExecutionBoundary: () => null }));
vi.mock("@/lib/organizacao/operante", () => ({ assertOrgOperante: vi.fn() }));
vi.mock("@/lib/automation/throttle", () => ({ espacarEnvio: vi.fn() }));

const org = "10000000-0000-4000-8000-000000000001";
const conv = "10000000-0000-4000-8000-000000000002";
const contact = "10000000-0000-4000-8000-000000000003";
const boundary = {
  organization_id: org,
  conversation_id: conv,
  contact_id: contact,
  service_revision: 1,
  demanda_id: null,
  demanda_revision: null,
};
const now = new Date("2026-10-12T12:00:00Z");
type Row = Record<string, unknown>;
function fixture() {
  const rows: Record<string, Row[]> = {
    ixc_service_order_watches: [
      {
        id: "watch",
        organization_id: org,
        contact_id: contact,
        conversation_id: conv,
        customer_id: "1",
        contract_id: "2",
        order_id: "27",
        service_revision: 1,
        service_boundary: boundary,
        snapshot: { status: "A" },
        state: "active",
        notice_state: "none",
        next_poll_at: now.toISOString(),
        inbox_item_id: "inbox",
      },
    ],
    contacts: [
      {
        id: contact,
        organization_id: org,
        source_metadata: {
          ixc_customer_id: "1",
          ixc_customer_name: "Cliente",
          ixc_linked_at: now.toISOString(),
          ixc_linked_by: "automatico",
        },
      },
    ],
    conversations: [{ id: conv, organization_id: org, channel_session_id: "channel" }],
    agent_inbox_items: [{ id: "inbox", organization_id: org, status: "open" }],
  };
  const writes: { table: string; filters: string[] }[] = [];
  const db = {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      const keys: string[] = [];
      let update: Row | undefined;
      let single = false;
      let insert: Row | undefined;
      const q = {
        select: () => q,
        order: () => q,
        limit: () => q,
        update: (v: Row) => {
          update = v;
          return q;
        },
        insert: (v: Row) => {
          insert = v;
          return q;
        },
        eq: (k: string, v: unknown) => {
          keys.push(k);
          filters.push((r) => r[k] === v);
          return q;
        },
        in: (k: string, v: unknown[]) => {
          filters.push((r) => v.includes(r[k]));
          return q;
        },
        lte: (k: string, v: string) => {
          filters.push((r) => String(r[k]) <= v);
          return q;
        },
        maybeSingle: () => {
          single = true;
          return q;
        },
        single: () => {
          single = true;
          return q;
        },
        then: (resolve: (v: unknown) => unknown) => {
          let selected = (rows[table] ?? []).filter((r) => filters.every((f) => f(r)));
          if (update) {
            selected.forEach((r) => Object.assign(r, update));
            writes.push({ table, filters: keys });
          }
          if (insert) {
            selected = [{ id: "inbox-new", ...insert }];
            rows[table]?.push(selected[0]!);
          }
          return Promise.resolve(
            resolve({
              data: structuredClone(single ? (selected[0] ?? null) : selected),
              error: null,
            }),
          );
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
  return { db, rows, watch: rows.ixc_service_order_watches![0]!, writes };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertOrgOperante).mockResolvedValue(undefined);
  vi.mocked(readServiceBoundarySupabase).mockResolvedValue({
    ...boundary,
    status: "open",
    demanda_fechada_em: null,
  });
  vi.mocked(carregarIntegracaoIxc).mockResolvedValue({
    ok: true,
    baseUrl: "https://ixc.example",
    token: "secret",
  });
  vi.mocked(consultarOrdemIxc).mockResolvedValue({
    id: "27",
    id_cliente: "1",
    id_contrato_kit: "2",
    id_assunto: "27",
    setor: "1",
    status: "F",
    finalizada: true,
  });
  vi.mocked(sendMessageHandler).mockImplementation(
    async (_db, ctx) => ({ id: ctx.internalMessageId, status: "sent" }) as never,
  );
});

describe("acompanhamento de O.S. por atendimento", () => {
  it("avisa finalização e aguarda confirmação sem fechar a conversa", async () => {
    const f = fixture();
    expect(await verificarOrdensAcompanhadas(f.db, now)).toEqual({ examinados: 1, avisados: 1 });
    expect(f.watch.state).toBe("awaiting_confirmation");
    expect(f.watch.notice_state).toBe("sent");
    expect(sendMessageHandler).toHaveBeenCalledWith(
      f.db,
      expect.objectContaining({ serviceBoundary: boundary }),
      expect.objectContaining({
        body: expect.stringContaining("funcionar normalmente?"),
        conversation_id: conv,
      }),
    );
    expect(f.writes.every((w) => w.filters.includes("organization_id"))).toBe(true);
    expect(f.writes.some((w) => w.table === "conversations")).toBe(false);
  });
  it("consultas seguintes não repetem o aviso", async () => {
    const f = fixture();
    await verificarOrdensAcompanhadas(f.db, now);
    await verificarOrdensAcompanhadas(f.db, new Date(now.getTime() + 300_000));
    expect(sendMessageHandler).toHaveBeenCalledTimes(1);
  });
  it("dois ticks concorrentes têm um único envio", async () => {
    const f = fixture();
    await Promise.all([
      verificarOrdensAcompanhadas(f.db, now),
      verificarOrdensAcompanhadas(f.db, now),
    ]);
    expect(sendMessageHandler).toHaveBeenCalledTimes(1);
  });
  it("atendimento reaberto não recebe aviso da revisão anterior", async () => {
    const f = fixture();
    vi.mocked(readServiceBoundarySupabase).mockResolvedValue({
      ...boundary,
      service_revision: 2,
      status: "open",
      demanda_fechada_em: null,
    });
    await verificarOrdensAcompanhadas(f.db, now);
    expect(f.watch.state).toBe("stopped");
    expect(sendMessageHandler).not.toHaveBeenCalled();
  });
  it.each(["force_human", "is_blocked", "is_personal"])(
    "não envia para contato com %s",
    async (flag) => {
      const f = fixture();
      f.rows.contacts![0]![flag] = true;
      await verificarOrdensAcompanhadas(f.db, now);
      expect(sendMessageHandler).not.toHaveBeenCalled();
    },
  );
  it("troca manual de cadastro impede aviso do cadastro anterior", async () => {
    const f = fixture();
    f.rows.contacts![0]!.source_metadata = {};
    await verificarOrdensAcompanhadas(f.db, now);
    expect(f.watch.state).toBe("stopped");
    expect(sendMessageHandler).not.toHaveBeenCalled();
  });
  it("automação desabilitada não consulta nem envia", async () => {
    const f = fixture();
    vi.mocked(carregarIntegracaoIxc).mockResolvedValue({ ok: false, reason: "resource_disabled" });
    await verificarOrdensAcompanhadas(f.db, now);
    expect(consultarOrdemIxc).not.toHaveBeenCalled();
    expect(sendMessageHandler).not.toHaveBeenCalled();
  });
  it("organização suspensa não consulta nem envia", async () => {
    const f = fixture();
    vi.mocked(assertOrgOperante).mockRejectedValue(new Error("suspended"));
    await verificarOrdensAcompanhadas(f.db, now);
    expect(consultarOrdemIxc).not.toHaveBeenCalled();
    expect(sendMessageHandler).not.toHaveBeenCalled();
  });
  it("timeout de envio deixa pendência e não repete a tentativa", async () => {
    const f = fixture();
    vi.mocked(sendMessageHandler).mockRejectedValue(new Error("timeout"));
    await verificarOrdensAcompanhadas(f.db, now);
    await verificarOrdensAcompanhadas(f.db, new Date(now.getTime() + 300_000));
    expect(sendMessageHandler).toHaveBeenCalledTimes(1);
    expect(f.watch.notice_state).toBe("review");
    expect(f.rows.agent_inbox_items![0]!.status).toBe("open");
  });
  it("O.S. reaberta invalida a confirmação da finalização anterior", async () => {
    const f = fixture();
    await verificarOrdensAcompanhadas(f.db, now);
    vi.mocked(consultarOrdemIxc).mockResolvedValue({
      id: "27",
      id_cliente: "1",
      id_contrato_kit: "2",
      id_assunto: "27",
      setor: "1",
      status: "A",
      finalizada: false,
    });
    await verificarOrdensAcompanhadas(f.db, new Date(now.getTime() + 300_000));
    expect(f.watch.state).toBe("active");
    expect(f.watch.last_notice_id).toBeNull();
  });
  it.each([true, false])(
    "recupera recibo sem reenviar somente se pertencer à O.S.: %s",
    async (mesmaOrdem) => {
      const f = fixture();
      Object.assign(f.watch, {
        snapshot: { status: "F" },
        state: "awaiting_confirmation",
        notice_state: "attempting",
        last_notice_id: "aviso",
      });
      f.rows.messages = [
        {
          id: "aviso",
          organization_id: org,
          conversation_id: conv,
          status: "delivered",
          metadata: { ixc_order_watch_id: mesmaOrdem ? "watch" : "outra-os" },
        },
      ];
      await verificarOrdensAcompanhadas(f.db, now);
      expect(f.watch.notice_state).toBe(mesmaOrdem ? "sent" : "review");
      expect(f.watch.state).toBe("awaiting_confirmation");
      expect(sendMessageHandler).not.toHaveBeenCalled();
    },
  );
});
