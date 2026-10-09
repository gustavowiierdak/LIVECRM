// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  requireSupportWrite: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  carregarIntegracaoIxc: vi.fn(),
  buscarClienteIxc: vi.fn(),
  vincularContatoAoIxc: vi.fn(),
}));

vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: mocks.requireSupportWrite }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/ixc/integration", () => ({ carregarIntegracaoIxc: mocks.carregarIntegracaoIxc }));
vi.mock("@/lib/ixc/client", () => ({
  buscarClienteIxc: mocks.buscarClienteIxc,
  IxcConnectionError: class IxcConnectionError extends Error {},
}));
vi.mock("@/lib/ixc/vinculo-do-contato", () => ({ vincularContatoAoIxc: mocks.vincularContatoAoIxc }));

import { POST } from "./route";

const ORGANIZATION_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const CONTACT_ID = "33333333-3333-4333-8333-333333333333";

function request(document = "123.456.789-09") {
  return new NextRequest(`https://crm.test/api/v1/contacts/${CONTACT_ID}/ixc-link`, {
    method: "POST",
    body: JSON.stringify({ document }),
  });
}

function params() {
  return { params: Promise.resolve({ id: CONTACT_ID }) };
}

function sessionContact(contact: { id: string; is_anonymized: boolean } | null) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: contact, error: null }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  mocks.createClient.mockResolvedValue({ from: vi.fn(() => query) });
  return query;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({
    ok: true,
    org: { orgId: ORGANIZATION_ID, name: "Org", role: "agent" },
    user: { id: USER_ID },
  });
  mocks.requireSupportWrite.mockResolvedValue(null);
  sessionContact({ id: CONTACT_ID, is_anonymized: false });
  mocks.createAdminClient.mockReturnValue({ admin: true });
  mocks.carregarIntegracaoIxc.mockResolvedValue({
    ok: true,
    baseUrl: "https://ixc.test",
    token: "segredo-que-nao-sai-da-rota",
  });
  mocks.buscarClienteIxc.mockResolvedValue({
    id: "17133",
    razao: "CLIENTE DE TESTE LTDA",
    fantasia: null,
    ativo: "S",
    telefone_celular: null,
    whatsapp: null,
  });
  mocks.vincularContatoAoIxc.mockResolvedValue({
    ok: true,
    alterado: true,
    vinculo: {
      customer_id: "17133",
      customer_name: "CLIENTE DE TESTE LTDA",
      linked_at: "2026-10-09T12:00:00.000Z",
      linked_by: "atendente",
    },
  });
});

describe("POST /api/v1/contacts/:id/ixc-link", () => {
  it("vincula a correspondência exata sob a organização e o usuário autenticados", async () => {
    const response = await POST(request(), params());

    expect(response.status).toBe(200);
    expect(mocks.carregarIntegracaoIxc).toHaveBeenCalledWith(
      { admin: true }, ORGANIZATION_ID, "customers",
    );
    expect(mocks.buscarClienteIxc).toHaveBeenCalledWith(
      "https://ixc.test", "segredo-que-nao-sai-da-rota", "12345678909",
    );
    expect(mocks.vincularContatoAoIxc).toHaveBeenCalledWith(
      { admin: true },
      expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        contactId: CONTACT_ID,
        document: "12345678909",
        origem: "atendente",
        permitirSubstituicao: true,
        actorUserId: USER_ID,
      }),
    );
    expect(JSON.stringify(await response.json())).not.toContain("segredo-que-nao-sai-da-rota");
  });

  it("não acessa segredo nem IXC quando o contato não passa pela RLS do usuário", async () => {
    const query = sessionContact(null);
    const response = await POST(request(), params());

    expect(response.status).toBe(404);
    expect(query.eq).toHaveBeenCalledWith("organization_id", ORGANIZATION_ID);
    expect(query.eq).toHaveBeenCalledWith("id", CONTACT_ID);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.buscarClienteIxc).not.toHaveBeenCalled();
  });

  it("bloqueia acompanhamento somente leitura antes de consultar o contato", async () => {
    mocks.requireSupportWrite.mockResolvedValue(new Response(null, { status: 403 }));
    const response = await POST(request(), params());

    expect(response.status).toBe(403);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.buscarClienteIxc).not.toHaveBeenCalled();
  });

  it("recusa CPF inválido sem consultar a integração", async () => {
    const response = await POST(request("123"), params());

    expect(response.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.buscarClienteIxc).not.toHaveBeenCalled();
  });
});
