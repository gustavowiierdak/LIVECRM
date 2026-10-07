import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  requireRole: vi.fn(),
  requireSupportWrite: vi.fn(),
  maybeSingle: vi.fn(),
  upsert: vi.fn(),
  eq: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: mocks.requireSupportWrite }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }));

import { GET, PATCH } from "./route";

const org = "05440000-0000-4000-8000-00000000000a";
const user = "05440000-1111-4000-8000-00000000000a";
const valid = {
  enabled: true,
  allowed_sectors: ["suporte"],
  allowed_origins: ["https://crm.liveinternet.com.br"],
  handoff_ttl_seconds: 900,
};

function request(body: unknown) {
  return new NextRequest("https://crm.liveinternet.com.br/api/v1/settings/webchat", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("configuração do canal web por organização", () => {
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSupportWrite.mockResolvedValue(undefined);
    mocks.requireRole.mockResolvedValue({ ok: true, org: { orgId: org }, user: { id: user } });
    mocks.from.mockReturnValue({ select: () => ({ eq: mocks.eq }), upsert: mocks.upsert });
    mocks.eq.mockReturnValue({ maybeSingle: mocks.maybeSingle });
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.upsert.mockResolvedValue({ error: null });
  });

  it("mostra desligado quando a empresa ainda não tem linha de configuração", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { enabled: false, allowed_sectors: [], allowed_origins: [] },
    });
    expect(mocks.eq).toHaveBeenCalledWith("organization_id", org);
  });

  it("não escreve em acompanhamento somente leitura", async () => {
    mocks.requireSupportWrite.mockResolvedValue(new Response(null, { status: 403 }));
    const response = await PATCH(request(valid));
    expect(response.status).toBe(403);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("recusa canal ligado sem setor e origem HTTPS canônica", async () => {
    expect((await PATCH(request({ ...valid, allowed_sectors: [] }))).status).toBe(422);
    expect(
      (await PATCH(request({ ...valid, allowed_origins: ["https://example.com/caminho"] }))).status,
    ).toBe(422);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("aceita HTTP no IP privado do ambiente local e recusa HTTP público", async () => {
    vi.stubEnv("DESKCOMM_ENV_MODE", "local");
    mocks.maybeSingle.mockResolvedValue({
      data: { public_id: "05440000-7777-4000-8000-000000000001" }, error: null,
    });

    const local = await PATCH(request({
      ...valid,
      allowed_origins: ["http://192.168.3.229:3001"],
    }));
    expect(local.status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ allowed_origins: ["http://192.168.3.229:3001"] }),
      { onConflict: "organization_id" },
    );

    mocks.upsert.mockClear();
    const publico = await PATCH(request({
      ...valid,
      allowed_origins: ["http://example.com:3001"],
    }));
    expect(publico.status).toBe(422);
    expect(mocks.upsert).not.toHaveBeenCalled();

    vi.stubEnv("DESKCOMM_ENV_MODE", "production");
    const privadoForaDoLocal = await PATCH(request({
      ...valid,
      allowed_origins: ["http://192.168.3.229:3001"],
    }));
    expect(privadoForaDoLocal.status).toBe(422);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("salva somente na organização do guard, com auditoria sem segredo", async () => {
    const response = await PATCH(request({ ...valid, organization_id: "org-forjada" }));
    expect(response.status).toBe(422);
    expect(mocks.upsert).not.toHaveBeenCalled();

    mocks.maybeSingle.mockResolvedValue({
      data: { public_id: "05440000-7777-4000-8000-000000000001" }, error: null,
    });
    const success = await PATCH(request(valid));
    expect(success.status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledWith(
      { ...valid, organization_id: org },
      { onConflict: "organization_id" },
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "webchat.config_updated",
        organizationId: org,
        metadata: expect.objectContaining({ enabled: true, origins_count: 1 }),
      }),
    );
  });
});
