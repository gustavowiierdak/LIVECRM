import { beforeEach, describe, expect, it, vi } from "vitest";

import { aplicarEfeitosPosEntrada } from "@/lib/channels/pos-entrada";

import { processarEntradaWebchat } from "./entrada-agente";

vi.mock("@/lib/channels/pos-entrada", () => ({ aplicarEfeitosPosEntrada: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

const entrada = {
  organizationId: "05440000-0000-4000-8000-00000000000a",
  conversationId: "05440000-1111-4000-8000-00000000000a",
  messageId: "05440000-2222-4000-8000-00000000000a",
  requestId: "request-1",
};

function consulta(data: unknown) {
  const q = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data, error: null })),
  };
  q.select.mockReturnValue(q);
  q.eq.mockReturnValue(q);
  return q;
}

describe("entrada web no mesmo fluxo de agente", () => {
  beforeEach(() => vi.clearAllMocks());

  it("despacha o ID canônico da mensagem nova, com a sessão e o contato do banco", async () => {
    const conversa = consulta({ channel: "webchat" });
    const mensagem = consulta({ id: entrada.messageId, body: "me manda o boleto",
      contact_id: "contato-1", channel_session_id: "sessao-web" });
    const contato = consulta({ display_name: "Cliente", name: "Nome antigo", force_human: false });
    const admin = { rpc: vi.fn(async () => ({ data: true, error: null })), from: vi.fn((table: string) => {
      if (table === "conversations") return conversa;
      if (table === "messages") return mensagem;
      if (table === "contacts") return contato;
      throw new Error(`tabela inesperada: ${table}`);
    }) };
    await processarEntradaWebchat(admin as never, entrada);
    expect(aplicarEfeitosPosEntrada).toHaveBeenCalledWith(admin, {
      organizationId: entrada.organizationId,
      conversationId: entrada.conversationId,
      messageId: entrada.messageId,
      contactId: "contato-1",
      channelSessionId: "sessao-web",
      texto: "me manda o boleto",
      nomeDoContato: "Nome antigo",
      requestId: entrada.requestId,
      origem: "webchat",
      canal: "webchat",
      despacharAgente: true,
    });
  });

  it("mantém a entrada humana sem despacho quando não há agente configurado", async () => {
    const admin = { rpc: vi.fn(async () => ({ data: false, error: null })), from: vi.fn((table: string) => {
      if (table === "conversations") return consulta({ channel: "webchat" });
      if (table === "messages") return consulta({ id: entrada.messageId, body: "oi",
        contact_id: "contato-1", channel_session_id: "sessao-web" });
      return consulta({ name: "Cliente", force_human: true });
    }) };
    await processarEntradaWebchat(admin as never, entrada);
    expect(aplicarEfeitosPosEntrada).toHaveBeenCalledWith(admin,
      expect.objectContaining({ despacharAgente: false }));
  });

  it("não despacha o handoff preso a conversa de outro canal", async () => {
    const admin = { from: vi.fn(() => consulta({ channel: "whatsapp" })) };
    await processarEntradaWebchat(admin as never, entrada);
    expect(aplicarEfeitosPosEntrada).not.toHaveBeenCalled();
  });
});
