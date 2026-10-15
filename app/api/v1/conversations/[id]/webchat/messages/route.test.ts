import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), scope: vi.fn(), rpc: vi.fn(), audit: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.auth }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: mocks.write }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: mocks.scope }) }) }) }) }) }));
const conv = "11111111-1111-4111-8111-111111111111";
const session = "22222222-2222-4222-8222-222222222222";
const original = "33333333-3333-4333-8333-333333333333";
const send = (extra: Record<string, unknown> = {}) => POST(new NextRequest(`http://localhost/api/v1/conversations/${conv}/webchat/messages`, {
  method: "POST", body: JSON.stringify({ visitor_session_id: session, body: "Resposta", idempotency_key: conv, ...extra }),
}), { params: Promise.resolve({ id: conv }) });

describe("resposta citada do operador web", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.write.mockResolvedValue(null);
    mocks.auth.mockResolvedValue({ ok: true, org: { orgId: "org" }, user: { id: "user" } });
    mocks.scope.mockResolvedValue({ data: { id: conv }, error: null });
    mocks.rpc.mockResolvedValue({ data: { ok: true, message: { id: "reply", body: "Resposta" } }, error: null });
  });
  it("envia somente a referência; o banco resolve a citação e valida seu escopo", async () => {
    expect((await send({ reply_to_message_id: original, reply_to: { body: "Texto forjado" } })).status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith("fn_responder_mensagem_webchat_operador", {
      p_organization_id: "org", p_source_conversation_id: conv, p_visitor_session_id: session,
      p_body: "Resposta", p_idempotency_key: conv, p_sent_by_user_id: "user", p_reply_to_message_id: original,
    });
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });
  it("preserva o envio simples sem exigir citação", async () => {
    expect((await send()).status).toBe(201);
    expect(mocks.rpc.mock.calls[0]?.[0]).toBe("fn_enviar_mensagem_webchat_operador");
  });
  it("nega conversa invisível antes de usar o client administrativo", async () => {
    mocks.scope.mockResolvedValue({ data: null, error: null });
    expect((await send({ reply_to_message_id: original })).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("nega identificador inválido sem enviar", async () => {
    expect((await send({ reply_to_message_id: "invalido" })).status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("não envia nem audita quando a mensagem citada está fora da sessão", async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: false, reason: "invalid_reply" }, error: null });
    expect((await send({ reply_to_message_id: original })).status).toBe(422);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
