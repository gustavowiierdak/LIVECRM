import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(), rpc: vi.fn(), upsert: vi.fn(), rate: vi.fn(), audit: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: mocks.rate }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/notifications/vapid", () => ({ vapidPronto: () => true, vapidPublica: () => "public-key" }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({
          data: table === "webchat_visitor_sessions" ? {
            id: "session-a", organization_id: "org-a",
            expires_at: new Date(Date.now() + 60_000).toISOString(), revoked_at: null,
          } : null,
          error: null,
        }),
        upsert: mocks.upsert,
      };
      return q;
    },
  }),
}));

import { GET, PUT } from "./route";

const publicId = "00000000-0000-4000-8000-000000000001";
const body = {
  endpoint: "https://push.example/subscription",
  keys: { p256dh: "a".repeat(86), auth: "b".repeat(22) },
  organization_id: "org-evil",
};

function request(origin = "https://portal.local", csrf = "csrf-ok") {
  return new NextRequest("https://portal.local/api/public/webchat/push", {
    method: "PUT",
    headers: {
      origin, "content-type": "application/json", "x-webchat-csrf": csrf,
      "x-webchat-public-id": publicId,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookies.mockResolvedValue({
    get: (name: string) => ({ value: name === "webchat_visitante" ? "opaque-session" : "csrf-ok" }),
  });
  mocks.rpc.mockImplementation(async (_name: string, args: { p_origin: string }) => ({
    data: args.p_origin === "https://portal.local"
      ? { ok: true, active: true, public_id: publicId }
      : { ok: false },
    error: null,
  }));
  mocks.rate.mockResolvedValue({ allowed: true });
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.audit.mockResolvedValue(undefined);
});

describe("inscricao push do visitante", () => {
  it("so aceita a sessao com Origin, CSRF e link correspondente", async () => {
    expect((await PUT(request("https://outro.local"))).status).toBe(403);
    expect((await PUT(request("https://portal.local", "errado"))).status).toBe(403);
    expect(mocks.upsert).not.toHaveBeenCalled();
    const wrong = new NextRequest("https://portal.local/api/public/webchat/push", {
      method: "PUT",
      headers: { origin: "https://portal.local", "x-webchat-csrf": "csrf-ok", "x-webchat-public-id": "outro" },
      body: JSON.stringify(body),
    });
    expect((await PUT(wrong)).status).toBe(403);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("salva a inscricao no tenant da sessao, ignorando organizacao do body", async () => {
    expect((await PUT(request())).status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      organization_id: "org-a", visitor_session_id: "session-a", endpoint: body.endpoint,
    }), { onConflict: "endpoint" });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-a", resourceId: "session-a",
    }));
  });

  it("so mostra a chave publica quando ha sessao valida", async () => {
    const valid = new NextRequest("https://portal.local/api/public/webchat/push");
    expect((await GET(valid)).status).toBe(200);
    mocks.rpc.mockResolvedValueOnce({ data: { ok: false }, error: null });
    expect((await GET(valid)).status).toBe(401);
  });
});
