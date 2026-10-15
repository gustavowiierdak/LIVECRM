import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

describe("clique no aviso do atendimento web", () => {
  it("foca a aba do atendimento, não outra aba do CRM", async () => {
    let onClick:
      | ((event: {
          notification: { close: () => void; data: { href: string } };
          waitUntil: (promise: Promise<unknown>) => void;
        }) => void)
      | undefined;
    const inbox = {
      url: "https://crm.example/app/inbox",
      focus: vi.fn(async () => {}),
      navigate: vi.fn(async () => {}),
    };
    const webchat = {
      url: "https://crm.example/atendimento/123",
      focus: vi.fn(async () => {}),
      navigate: vi.fn(async () => {}),
    };
    const source = readFileSync("public/notify-sw.js", "utf8");
    runInNewContext(source, {
      URL,
      self: {
        location: { origin: "https://crm.example" },
        addEventListener: (name: string, handler: typeof onClick) => {
          if (name === "notificationclick") onClick = handler;
        },
        clients: { matchAll: async () => [inbox, webchat] },
      },
    });
    expect(onClick).toBeDefined();
    let pending: Promise<unknown> | undefined;
    onClick?.({
      notification: { close: vi.fn(), data: { href: "/atendimento/123" } },
      waitUntil: (promise) => {
        pending = promise;
      },
    });
    await pending;
    expect(webchat.focus).toHaveBeenCalledOnce();
    expect(webchat.navigate).toHaveBeenCalledWith("https://crm.example/atendimento/123");
    expect(inbox.focus).not.toHaveBeenCalled();
  });
});

describe("push com o atendimento em segundo plano", () => {
  async function receber(
    clientes: Array<{ url: string; visibilityState: string; focused?: boolean }>,
    channel?: string,
  ) {
    let handler:
      | ((event: {
          data: { json: () => unknown };
          waitUntil: (promise: Promise<unknown>) => void;
        }) => void)
      | undefined;
    const showNotification = vi.fn().mockResolvedValue(undefined);
    runInNewContext(readFileSync("public/notify-sw.js", "utf8"), {
      URL,
      self: {
        location: { origin: "https://crm.example" },
        addEventListener: (name: string, callback: typeof handler) => {
          if (name === "push") handler = callback;
        },
        clients: { matchAll: async () => clientes },
        registration: { showNotification },
      },
    });
    let pending: Promise<unknown> | undefined;
    handler?.({
      data: {
        json: () => ({
          title: "Novo atendimento",
          body: "Abra para responder",
          href: "/app/inbox?id=c1",
          tag: "msg:c1",
          channel,
        }),
      },
      waitUntil: (promise) => {
        pending = promise;
      },
    });
    expect(handler).toBeDefined();
    await pending;
    return showNotification;
  }
  it("sem abas abertas exibe o aviso nativo com destino da conversa", async () => {
    const show = await receber([]);
    expect(show).toHaveBeenCalledWith(
      "Novo atendimento",
      expect.objectContaining({ tag: "msg:c1", data: { href: "/app/inbox?id=c1" } }),
    );
  });
  it("portal público em foco não suprime aviso do atendente", async () => {
    expect(
      await receber([
        { url: "https://crm.example/atendimento/test", visibilityState: "visible", focused: true },
      ]),
    ).toHaveBeenCalledOnce();
  });
  it("CRM visível mas sem foco continua recebendo no sistema", async () => {
    expect(
      await receber([
        { url: "https://crm.example/app/inbox", visibilityState: "visible", focused: false },
      ]),
    ).toHaveBeenCalledOnce();
  });
  it("CRM em foco mantém a entrega realtime local, sem duplicar push", async () => {
    expect(
      await receber([
        { url: "https://crm.example/app/inbox", visibilityState: "visible", focused: true },
      ]),
    ).not.toHaveBeenCalled();
  });
  it("push do visitante continua produzindo aviso mesmo com portal em foco", async () => {
    expect(
      await receber(
        [
          {
            url: "https://crm.example/atendimento/test",
            visibilityState: "visible",
            focused: true,
          },
        ],
        "webchat",
      ),
    ).toHaveBeenCalledOnce();
  });
});
