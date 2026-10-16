import { beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ from: vi.fn(), send: vi.fn(), window: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: fake.from }) }));
vi.mock("@/app/api/v1/messages/_handler", () => ({ sendMessageHandler: fake.send }));
vi.mock("@/lib/channels/janela", () => ({ estadoDaJanela: fake.window }));
import { avisoDoAtendimentoHandler } from "./aviso-do-atendimento.handler";
import type { EventRow } from "@/lib/event-log/dispatcher";
import { OrgNaoOperanteError } from "@/lib/organizacao/operante";
const noticeId = "06800000-0000-4000-8000-000000000001";
const event: EventRow = {
  id: "event-1",
  organization_id: "org-1",
  entity_id: "conv-1",
  entity_kind: "conversation",
  event_type: "attendance.notice_requested",
  payload: { notice_id: noticeId, body: "TEXTO FORJADO" },
  metadata: {},
  consumed_by: [],
  attempts: 0,
};
let notice: Record<string, unknown> | null;
let conv: Record<string, unknown>;
let existing: Record<string, unknown> | null;
beforeEach(() => {
  vi.clearAllMocks();
  notice = {
    id: noticeId,
    protocol: "20261015-000001",
    kind: "iniciado",
    body: "Seu atendimento foi iniciado. Protocolo: 20261015-000001.",
    assigned_to_user_id: null,
  };
  conv = {
    service_protocol: notice.protocol,
    status: "open",
    channel: "whatsapp",
    is_group: false,
    assigned_to_user_id: null,
    last_inbound_at: new Date().toISOString(),
    channel_sessions: { provider: "test" },
  };
  existing = null;
  fake.window.mockReturnValue({ tipo: "sem_restricao" });
  fake.send.mockResolvedValue({ id: noticeId, status: "sent" });
  fake.from.mockImplementation((table: string) => {
    const q = {
      select: vi.fn(() => q),
      eq: vi.fn(() => q),
      maybeSingle: async () => ({
        data: table === "attendance_notices" ? notice : table === "conversations" ? conv : existing,
        error: null,
      }),
    };
    return q;
  });
});
describe("avisos determinísticos do atendimento", () => {
  it("envia texto protegido, com id estável e sem depender de um agente", async () => {
    expect(await avisoDoAtendimentoHandler.handle(event)).toMatchObject({ status: "ok" });
    expect(fake.send).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organization_id: "org-1", internalMessageId: noticeId }),
      expect.objectContaining({ body: notice!.body, conversation_id: "conv-1" }),
    );
  });
  it("evento forjado sem outbox não autoriza mensagem", async () => {
    notice = null;
    expect(await avisoDoAtendimentoHandler.handle(event)).toMatchObject({ status: "skipped" });
    expect(fake.send).not.toHaveBeenCalled();
  });
  it("retry depois de enviado não duplica", async () => {
    existing = { id: noticeId, status: "sent" };
    expect(await avisoDoAtendimentoHandler.handle(event)).toMatchObject({
      status: "ok",
      detail: "ja_enviado",
    });
    expect(fake.send).not.toHaveBeenCalled();
  });
  it("aviso antigo não atravessa a reabertura de outro protocolo", async () => {
    conv.service_protocol = "20261015-000002";
    expect(await avisoDoAtendimentoHandler.handle(event)).toMatchObject({ status: "skipped" });
    expect(fake.send).not.toHaveBeenCalled();
  });
  it("aviso de encerramento sai depois de fechado, sem reabrir o atendimento", async () => {
    notice!.kind = "encerrado";
    conv.status = "closed";
    expect(await avisoDoAtendimentoHandler.handle(event)).toMatchObject({ status: "ok" });
  });
  it("falha de canal não vira sucesso; o dreno pode tentar e avisar a equipe", async () => {
    fake.send.mockRejectedValue(new Error("segredo que nao deve ir no log"));
    expect(await avisoDoAtendimentoHandler.handle(event)).toMatchObject({
      status: "error",
      detail: "Error",
    });
  });
  it("organização suspensa no meio do envio não acumula aviso para reativação", async () => {
    fake.send.mockRejectedValue(new OrgNaoOperanteError("org-1"));
    expect(await avisoDoAtendimentoHandler.handle(event)).toMatchObject({
      status: "skipped",
      detail: "org_nao_operante",
    });
  });
});
