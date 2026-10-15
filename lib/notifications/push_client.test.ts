import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ worker: vi.fn(), permission: vi.fn(), enabled: vi.fn() }));
vi.mock("./permission", () => ({
  getPermission: mocks.permission,
  areAlertsEnabled: mocks.enabled,
}));
vi.mock("./service_worker", () => ({ ensureNotifyServiceWorker: mocks.worker }));

const subscription = {
  toJSON: () => ({
    endpoint: "https://push.example/test",
    keys: { auth: "test-auth", p256dh: "test-key" },
  }),
};
let fetchMock: ReturnType<typeof vi.fn>;
let manager: { getSubscription: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.permission.mockReturnValue("granted");
  mocks.enabled.mockReturnValue(true);
  manager = {
    getSubscription: vi.fn().mockResolvedValue(subscription),
    subscribe: vi.fn().mockResolvedValue(subscription),
  };
  mocks.worker.mockResolvedValue({ pushManager: manager });
  fetchMock = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { enabled: true, public_key: "AQID" } }),
    })
    .mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ativação de push do operador", () => {
  it("só confirma ready depois de salvar a inscrição autenticada", async () => {
    const client = await import("./push_client");
    const changed = vi.fn();
    const off = client.subscribePushStatus(changed);
    expect(await client.syncPushSubscription()).toBe("ready");
    expect(client.getPushStatus()).toBe("ready");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/v1/notifications/push",
      expect.objectContaining({ method: "PUT" }),
    );
    const saved = fetchMock.mock.calls[1]?.[1];
    if (!saved) throw new Error("PUT não foi chamado");
    expect(JSON.parse(saved.body)).toEqual(subscription.toJSON());
    expect(changed).toHaveBeenCalledTimes(2);
    off();
  });
  it("cria inscrição ausente e reaproveita a existente sem duplicar", async () => {
    manager.getSubscription.mockResolvedValue(null);
    const client = await import("./push_client");
    const first = client.syncPushSubscription();
    expect(client.syncPushSubscription()).toBe(first);
    expect(await first).toBe("ready");
    expect(manager.subscribe).toHaveBeenCalledOnce();
    expect(manager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("sem configuração do servidor não promete entrega com aba fechada", async () => {
    fetchMock.mockReset().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { enabled: false, public_key: null } }),
    });
    const client = await import("./push_client");
    expect(await client.syncPushSubscription()).toBe("server_unavailable");
    expect(manager.subscribe).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it.each([401, 503])("PUT %i não se passa por inscrição confirmada", async () => {
    fetchMock
      .mockReset()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { enabled: true, public_key: "AQID" } }),
      })
      .mockResolvedValue({ ok: false });
    const client = await import("./push_client");
    expect(await client.syncPushSubscription()).toBe("error");
    expect(client.getPushStatus()).not.toBe("ready");
  });
  it("rede indisponível permite uma nova tentativa sem rejeição solta", async () => {
    fetchMock.mockReset().mockRejectedValueOnce(new Error("offline"));
    const client = await import("./push_client");
    expect(await client.syncPushSubscription()).toBe("error");
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { enabled: true, public_key: "AQID" } }),
      })
      .mockResolvedValue({ ok: true });
    expect(await client.syncPushSubscription()).toBe("ready");
  });
  it("sai de Ativando quando o service worker trava e permite nova tentativa", async () => {
    vi.useFakeTimers();
    mocks.worker.mockImplementationOnce(() => new Promise(() => {}));
    const client = await import("./push_client");
    const first = client.syncPushSubscription();
    expect(client.getPushStatus()).toBe("syncing");
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await first).toBe("error");
    expect(client.getPushStatus()).toBe("error");
    expect(await client.syncPushSubscription()).toBe("ready");
  });
  it("resultado atrasado da tentativa expirada não sobrescreve a nova inscrição", async () => {
    vi.useFakeTimers();
    let liberarWorker!: (value: { pushManager: typeof manager }) => void;
    mocks.worker.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          liberarWorker = resolve;
        }),
    );
    const client = await import("./push_client");
    const expirada = client.syncPushSubscription();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await expirada).toBe("error");
    expect(await client.syncPushSubscription()).toBe("ready");
    liberarWorker({ pushManager: manager });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(client.getPushStatus()).toBe("ready");
  });
  it("sem permissão não registra nem pede permissão por conta própria", async () => {
    mocks.permission.mockReturnValue("default");
    const client = await import("./push_client");
    expect(await client.syncPushSubscription()).toBe("disabled");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.worker).not.toHaveBeenCalled();
  });
  it("sem service worker mostra limitação em vez de sucesso", async () => {
    mocks.worker.mockResolvedValue(null);
    const client = await import("./push_client");
    expect(await client.syncPushSubscription()).toBe("unsupported");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
