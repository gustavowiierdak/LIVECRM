import { afterEach, expect, it, vi } from "vitest";
import { ensureNotifyServiceWorker } from "./service_worker";
afterEach(() => vi.unstubAllGlobals());
it("na primeira instalação aguarda o worker ativo antes da inscrição", async () => {
  let activate: (value: unknown) => void = () => {};
  const active = { active: {}, pushManager: {} };
  const ready = new Promise((resolve) => {
    activate = resolve;
  });
  const register = vi.fn().mockResolvedValue({ active: null });
  vi.stubGlobal("navigator", { serviceWorker: { register, ready } });
  const done = vi.fn();
  const pending = ensureNotifyServiceWorker().then(done);
  await Promise.resolve();
  expect(done).not.toHaveBeenCalled();
  activate(active);
  await pending;
  expect(register).toHaveBeenCalledWith("/notify-sw.js", { scope: "/" });
  expect(done).toHaveBeenCalledWith(active);
});
it("falha de registro não deixa rejeição solta", async () => {
  vi.stubGlobal("navigator", {
    serviceWorker: { register: vi.fn().mockRejectedValue(new Error("blocked")) },
  });
  expect(await ensureNotifyServiceWorker()).toBeNull();
});
