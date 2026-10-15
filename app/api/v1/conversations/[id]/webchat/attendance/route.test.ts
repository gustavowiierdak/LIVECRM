import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), scope: vi.fn(), enrich: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.auth }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: mocks.scope }) }) }) }),
}) }));
vi.mock("@/lib/webchat/enriquecer-mensagens", () => ({ enriquecerMensagensWebchat: mocks.enrich }));
const conversation = "11111111-1111-4111-8111-111111111111";
const session = "22222222-2222-4222-8222-222222222222";
const another = "33333333-3333-4333-8333-333333333333";
const call = (query = "") => GET(new NextRequest(`http://localhost/api/v1/conversations/${conversation}/webchat/attendance${query}`), { params: Promise.resolve({ id: conversation }) });

describe("leitura conjunta do atendimento web", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ ok: true, user: { id: "user" }, org: { orgId: "org" } });
    mocks.scope.mockResolvedValue({ data: { id: conversation }, error: null });
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name.includes("listar")
      ? [{ id: session, sector: "suporte", active: true }] : [{ id: "message", body: "Olá" }], error: null }));
    mocks.enrich.mockImplementation(async (_admin, _org, _session, messages) => messages);
  });
  it("entrega sessão e mensagens juntas, sempre no escopo autenticado", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ selected_session_id: session, messages: [{ id: "message" }] });
    expect(mocks.rpc).toHaveBeenLastCalledWith("fn_ler_mensagens_webchat_operador", {
      p_organization_id: "org", p_source_conversation_id: conversation, p_visitor_session_id: session,
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("não consulta dados quando o guard recusa", async () => {
    mocks.auth.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await call()).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("nega conversa que a RLS não permite ver", async () => {
    mocks.scope.mockResolvedValue({ data: null, error: null });
    expect((await call()).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("não usa sessão de outro atendimento", async () => {
    expect((await call(`?visitor_session_id=${another}`)).status).toBe(404);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.enrich).not.toHaveBeenCalled();
  });
  it("não transforma falha em histórico vazio", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "database unavailable" } });
    expect((await call()).status).toBe(500);
  });
  it("aceita lista vazia sem fazer leitura de mensagens", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    expect((await (await call()).json()).data).toEqual({ sessions: [], selected_session_id: "", messages: [] });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
