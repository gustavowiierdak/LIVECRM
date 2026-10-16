import { expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertAttendanceNotice } from "./aviso-autorizado";

function client(overrides: Record<string, unknown> = {}, kind = "encerrado", valid = true) {
  const from = vi.fn((table: string) => {
    const q = {
      select: () => q,
      eq: vi.fn(() => q),
      maybeSingle: async () => ({
        error: null,
        data:
          table === "attendance_notices"
            ? {
                protocol: "p-1",
                kind,
                body: "Seu atendimento foi encerrado. Protocolo: p-1.",
                assigned_to_user_id: null,
              }
            : {
                service_protocol: "p-1",
                status: "closed",
                assigned_to_user_id: null,
                channel: "whatsapp",
                is_group: false,
                ...overrides,
              },
      }),
    };
    return q;
  });
  return {
    from,
    rpc: vi.fn(async () => ({ data: valid, error: null })),
  } as unknown as SupabaseClient;
}
it("revalida o silêncio no transporte e recusa aviso após resposta ou handoff", async () => {
  await expect(
    assertAttendanceNotice(client({ status: "open" }, "inatividade", true), "org", "conv", body, {
      noticeId: "notice",
    }),
  ).resolves.toBeUndefined();
  await expect(
    assertAttendanceNotice(client({ status: "open" }, "inatividade", false), "org", "conv", body, {
      noticeId: "notice",
    }),
  ).rejects.toThrow();
});
const body = "Seu atendimento foi encerrado. Protocolo: p-1.";
it("autoriza só o texto registrado da finalização, mesmo com conversa fechada", async () => {
  await expect(
    assertAttendanceNotice(client(), "org", "conv", body, { noticeId: "notice" }),
  ).resolves.toBeUndefined();
});
it("nova abertura entre o consumo e o transporte invalida a mensagem antiga", async () => {
  await expect(
    assertAttendanceNotice(
      client({ service_protocol: "p-2", status: "open" }),
      "org",
      "conv",
      body,
      { noticeId: "notice" },
    ),
  ).rejects.toThrow();
});
it("não transforma o aviso em autorização genérica para falar depois de encerrar", async () => {
  await expect(
    assertAttendanceNotice(client(), "org", "conv", "Texto arbitrário", { noticeId: "notice" }),
  ).rejects.toThrow();
});
