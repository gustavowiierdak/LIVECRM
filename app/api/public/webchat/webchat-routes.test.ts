import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  rpc: vi.fn(),
  rateLimit: vi.fn(),
  processarEntrada: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: mocks.rateLimit }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/webchat/entrada-agente", () => ({ processarEntradaWebchat: mocks.processarEntrada }));

import { POST as consumir } from "./consume/route";
import { GET as lerMensagens, POST as enviarMensagem } from "./messages/route";
import { GET as lerSessao } from "./session/route";
import { POST as iniciar } from "./start/route";

const token = "t".repeat(32);
const key = "00000000-0000-4000-8000-000000000001";

function request(path: string, headers: HeadersInit, body: unknown) {
  return new NextRequest(`https://portal.local${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("rotas públicas de webchat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimit.mockResolvedValue({ allowed: true });
    mocks.processarEntrada.mockResolvedValue(undefined);
    mocks.cookies.mockResolvedValue({
      get: (name: string) =>
        name === "webchat_visitante" ? { value: "sessao-segura" } : { value: "csrf-seguro" },
    });
  });

  it("recusa consumo sem Origin canônico antes de consultar o banco", async () => {
    const response = await consumir(request("/api/public/webchat/consume", {}, { token }));

    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("inicia sem código só para o link configurado e devolve sessão, não IDs internos", async () => {
    const publicId = "05440000-7777-4000-8000-000000000001";
    const body = {
      public_id: publicId,
      name: "Cliente Novo",
      sector: "suporte",
      body: "Minha internet caiu",
      idempotency_key: key,
    };
    expect((await iniciar(request("/api/public/webchat/start", {}, body))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({
      data: {
        ok: true,
        sector: "suporte",
        expires_at: "2026-10-07T00:00:00Z",
        organization_id: "05440000-0000-4000-8000-00000000000a",
        conversation_id: "05440000-4444-4000-8000-00000000000a",
        message: {
          id: "message-1",
          direction: "visitor",
          body: body.body,
          created_at: "2026-10-06T00:00:00Z",
        },
      },
      error: null,
    });
    const response = await iniciar(
      request("/api/public/webchat/start", { origin: "https://portal.local" }, body),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toContain("webchat_visitante=");
    expect(await response.json()).toMatchObject({ data: { message: { body: body.body } } });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "fn_iniciar_webchat_publico",
      expect.objectContaining({ p_public_id: publicId, p_origin: "https://portal.local" }),
    );
  });

  it("não cria cookie de sessão quando o banco nega token expirado, revogado ou repetido", async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: false }, error: null });

    const response = await consumir(
      request("/api/public/webchat/consume", { origin: "https://portal.local" }, { token }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("entrega os dois cookies na resposta que consumiu o código", async () => {
    mocks.rpc.mockResolvedValue({
      data: { ok: true, sector: "suporte", expires_at: "2026-10-07T00:00:00Z" },
      error: null,
    });

    const response = await consumir(
      request("/api/public/webchat/consume", { origin: "https://portal.local" }, { token }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("webchat_visitante=");
    expect(response.headers.get("set-cookie")).toContain("webchat_csrf=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("recusa POST de visitante sem o par cookie/header CSRF", async () => {
    mocks.cookies.mockResolvedValue({
      get: (name: string) =>
        name === "webchat_visitante" ? { value: "sessao-segura" } : undefined,
    });

    const response = await enviarMensagem(
      request(
        "/api/public/webchat/messages",
        { origin: "https://portal.local" },
        { body: "oi", idempotency_key: key },
      ),
    );

    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("leva a chave idempotente ao RPC da sessão visitante", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        ok: true,
        message: {
          id: "message-1",
          direction: "visitor",
          body: "oi",
          created_at: "2026-10-06T00:00:00Z",
        },
      },
      error: null,
    });

    const response = await enviarMensagem(
      request(
        "/api/public/webchat/messages",
        { origin: "https://portal.local", "x-webchat-csrf": "csrf-seguro" },
        { body: "oi", idempotency_key: key },
      ),
    );

    expect(response.status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "fn_registrar_mensagem_webchat_visitante",
      expect.objectContaining({ p_idempotency_key: key, p_origin: "https://portal.local" }),
    );
    expect(mocks.processarEntrada).not.toHaveBeenCalled();
  });

  it("despacha só a mensagem nova para o agente da conversa validada pelo banco", async () => {
    const organizationId = "05440000-0000-4000-8000-00000000000a";
    const conversationId = "05440000-4444-4000-8000-00000000000a";
    mocks.rpc.mockResolvedValue({ data: {
      ok: true, new_message: true, organization_id: organizationId,
      conversation_id: conversationId,
      message: { id: "mensagem-1", direction: "visitor", body: "oi", created_at: "2026-10-08T12:00:00Z" },
    }, error: null });
    const response = await enviarMensagem(request(
      "/api/public/webchat/messages",
      { origin: "https://portal.local", "x-webchat-csrf": "csrf-seguro" },
      { body: "oi", idempotency_key: key },
    ));
    expect(response.status).toBe(201);
    expect(mocks.processarEntrada).toHaveBeenCalledWith(expect.anything(), {
      organizationId, conversationId, messageId: "mensagem-1", requestId: expect.any(String),
    });
  });

  it("informa que a conversa foi encerrada sem transformar o fechamento em sessão expirada", async () => {
    mocks.rpc.mockResolvedValue({
      data: { ok: false, reason: "conversation_closed" },
      error: null,
    });

    const response = await enviarMensagem(
      request(
        "/api/public/webchat/messages",
        { origin: "https://portal.local", "x-webchat-csrf": "csrf-seguro" },
        { body: "ainda está aí?", idempotency_key: key },
      ),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "conflict", message: "Este atendimento foi encerrado." },
    });
  });

  it("responde sessão expirada quando a leitura não encontra sessão ativa", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });

    const response = await lerMensagens(
      new NextRequest("https://portal.local/api/public/webchat/messages", {
        headers: { origin: "https://portal.local" },
      }),
    );

    expect(response.status).toBe(401);
  });

  it("retoma sessão e lê mensagens atrás de proxy mesmo sem Origin no GET", async () => {
    const publicId = "05440000-7777-4000-8000-000000000001";
    mocks.rpc.mockImplementation(async (name: string) => ({
      data:
        name === "fn_webchat_sessao_visitante"
          ? {
              ok: true,
              sector: "suporte",
              expires_at: "2030-01-01T00:00:00Z",
              public_id: publicId,
              active: true,
            }
          : [],
      error: null,
    }));
    const headers = {
      referer: `https://portal.local/atendimento/${publicId}`,
      "x-webchat-public-id": publicId,
    };
    expect(
      (
        await lerSessao(
          new NextRequest("http://app:3000/api/public/webchat/session", {
            headers,
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await lerMensagens(
          new NextRequest("http://app:3000/api/public/webchat/messages", {
            headers,
          }),
        )
      ).status,
    ).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "fn_webchat_sessao_visitante",
      expect.objectContaining({ p_origin: "https://portal.local" }),
    );
  });

  it("mantém a sessão encerrada legível e devolve o estado para a página pública", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        ok: true,
        sector: "suporte",
        expires_at: "2030-01-01T00:00:00Z",
        active: false,
        closed_at: "2026-10-07T23:58:00Z",
      },
      error: null,
    });

    const response = await lerSessao(
      new NextRequest("https://portal.local/api/public/webchat/session", {
        headers: { origin: "https://portal.local" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { active: false, closed_at: "2026-10-07T23:58:00Z" },
    });
  });
});
