import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  requireRole: vi.fn(),
  requireSupportWrite: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: mocks.requireSupportWrite }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));

import { POST } from "./route";

const conversationId = "00000000-0000-4000-8000-000000000001";
const organizationId = "00000000-0000-4000-8000-000000000002";
const userId = "00000000-0000-4000-8000-000000000003";

function request() {
  return new NextRequest(
    `https://crm.local/api/v1/conversations/${conversationId}/webchat-handoffs`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sector: "suporte" }),
    },
  );
}

describe("emissão staff de handoff webchat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSupportWrite.mockResolvedValue(undefined);
    mocks.requireRole.mockResolvedValue({
      ok: true,
      org: { orgId: organizationId },
      user: { id: userId },
    });
  });

  it("não chega ao RBAC ou banco quando suporte está somente leitura", async () => {
    mocks.requireSupportWrite.mockResolvedValue(new Response(null, { status: 403 }));

    const response = await POST(request(), { params: Promise.resolve({ id: conversationId }) });

    expect(response.status).toBe(403);
    expect(mocks.requireRole).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("não chega ao banco quando o guard de agente recusa o operador", async () => {
    mocks.requireRole.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    });

    const response = await POST(request(), { params: Promise.resolve({ id: conversationId }) });

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("usa organização confiável do guard, nunca do corpo, para limitar o RPC", async () => {
    mocks.rpc.mockResolvedValue({
      data: { ok: true, handoff_id: "handoff-1", expires_at: "2026-10-06T01:00:00Z" },
      error: null,
    });

    const response = await POST(request(), { params: Promise.resolve({ id: conversationId }) });

    expect(response.status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "fn_emitir_webchat_handoff",
      expect.objectContaining({
        p_organization_id: organizationId,
        p_source_conversation_id: conversationId,
        p_issued_by: userId,
      }),
    );
  });
});
