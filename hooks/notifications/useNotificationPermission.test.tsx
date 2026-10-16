import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useNotificationPermission } from "./useNotificationPermission";
const mocks = vi.hoisted(() => ({ resume: vi.fn(), sync: vi.fn(), emit: vi.fn() }));
vi.mock("@/lib/notifications/sounds", () => ({ resumeAudio: mocks.resume }));
vi.mock("@/lib/notifications/emit", () => ({ emitNotification: mocks.emit }));
vi.mock("@/lib/notifications/push_client", () => ({
  syncPushSubscription: mocks.sync,
  getPushStatus: () => "idle",
  getServerPushStatus: () => "idle",
  subscribePushStatus: () => () => {},
}));
beforeEach(() => {
  localStorage.clear();
  mocks.resume.mockReset().mockReturnValue(new Promise(() => {}));
  mocks.sync.mockReset().mockResolvedValue("ready");
  mocks.emit.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

it("a permissão nativa é pedida antes de aguardar áudio; a inscrição é aguardada", async () => {
  const requestPermission = vi.fn().mockResolvedValue("granted");
  vi.stubGlobal("Notification", { permission: "granted", requestPermission });
  const { result } = renderHook(() => useNotificationPermission());
  let pending: Promise<unknown> | undefined;
  await act(async () => {
    pending = result.current.request();
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(requestPermission.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.resume.mock.invocationCallOrder[0] ?? Number.NaN,
    );
    await pending;
  });
  expect(mocks.sync).toHaveBeenCalledOnce();
  expect(result.current.enabled).toBe(true);
  expect(mocks.emit).toHaveBeenCalledOnce();
});
it("recusa não cria inscrição nem confirmação falsa", async () => {
  vi.stubGlobal("Notification", {
    permission: "denied",
    requestPermission: vi.fn().mockResolvedValue("denied"),
  });
  const { result } = renderHook(() => useNotificationPermission());
  await act(async () => {
    await result.current.request();
  });
  expect(mocks.sync).not.toHaveBeenCalled();
  expect(mocks.emit).not.toHaveBeenCalled();
  expect(result.current.enabled).toBe(false);
});

it("falha ao salvar a inscrição não emite confirmação de sucesso", async () => {
  vi.stubGlobal("Notification", { permission: "granted", requestPermission: vi.fn().mockResolvedValue("granted") });
  mocks.sync.mockResolvedValue("error");
  const { result } = renderHook(() => useNotificationPermission());
  await act(async () => { await result.current.request(); });
  expect(mocks.emit).not.toHaveBeenCalled();
});

it("voltar das permissões do navegador atualiza o bloqueio sem recarregar", () => {
  const native = { permission: "denied", requestPermission: vi.fn() };
  vi.stubGlobal("Notification", native);
  const { result } = renderHook(() => useNotificationPermission());
  expect(result.current.permission).toBe("denied");
  native.permission = "granted";
  act(() => { window.dispatchEvent(new Event("focus")); });
  expect(result.current.permission).toBe("granted");
  expect(native.requestPermission).not.toHaveBeenCalled();
});
