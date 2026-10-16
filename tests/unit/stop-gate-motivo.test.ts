import type pg from "pg";
import { describe, expect, it, vi } from "vitest";

import { runBeforeSend } from "@/lib/agent-engine/guardrails/before-send";

type Flags = {
  is_blocked: boolean;
  force_human: boolean;
  is_personal: boolean;
};

async function tentarEnviar(flags: Flags, optedOutThisTurn = false) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("as stopped")) {
      return { rows: [{ ...flags, stopped: flags.is_blocked || flags.force_human || flags.is_personal }] };
    }
    return { rows: [] };
  });
  const persist = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [{ id: "trace-1" }] }));
  const pool = {
    connect: vi.fn(async () => ({ query, release: vi.fn() })),
    query: persist,
  } as unknown as pg.Pool;
  const send = vi.fn(async () => ({ kind: "sent" as const, idempotencyKey: "k", messageId: "m" }));
  const result = await runBeforeSend({
    pool,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    tenantId: "00000000-0000-4000-8000-000000000001",
    leadId: "00000000-0000-4000-8000-000000000002",
    jobId: "00000000-0000-4000-8000-000000000003",
    channelSessionId: "00000000-0000-4000-8000-000000000004",
    body: "Resposta automática de teste",
    optedOutThisTurn,
    crmDailyLimit: null,
    now: new Date("2026-10-15T14:00:00Z"),
    rng: () => 0,
    sleep: async () => {},
    send,
  });
  return { result, send, persist };
}

describe("gate STOP preserva a trava e registra o motivo certo", () => {
  it("force_human veta o envio como passagem humana, sem afirmar opt-out", async () => {
    const { result, send, persist } = await tentarEnviar({
      is_blocked: false,
      force_human: true,
      is_personal: false,
    });
    expect(result).toMatchObject({ status: "vetoed", gate: "stop", code: "automatico_pausado_para_humano" });
    expect(send).not.toHaveBeenCalled();
    const trace = persist.mock.calls.find(([sql]) => String(sql).includes("before_send_traces"));
    expect(trace?.[1]).toContain("automatico_pausado_para_humano");
  });

  it("opt-out real continua vetado com seu próprio código", async () => {
    const { result, send } = await tentarEnviar({
      is_blocked: true,
      force_human: true,
      is_personal: false,
    });
    expect(result).toMatchObject({ status: "vetoed", gate: "stop", code: "contato_bloqueado" });
    expect(send).not.toHaveBeenCalled();
  });

  it("contato pessoal também não vira opt-out", async () => {
    const { result, send } = await tentarEnviar({
      is_blocked: false,
      force_human: false,
      is_personal: true,
    });
    expect(result).toMatchObject({ status: "vetoed", gate: "stop", code: "contato_pessoal" });
    expect(send).not.toHaveBeenCalled();
  });

  it("opt-out detectado neste turno mantém prioridade", async () => {
    const { result, send } = await tentarEnviar({
      is_blocked: false,
      force_human: true,
      is_personal: false,
    }, true);
    expect(result).toMatchObject({ status: "vetoed", gate: "stop", code: "contato_bloqueado" });
    expect(send).not.toHaveBeenCalled();
  });
});
