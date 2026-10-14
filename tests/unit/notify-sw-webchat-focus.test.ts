import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

describe("clique no aviso do atendimento web", () => {
  it("foca a aba do atendimento, não outra aba do CRM", async () => {
    let onClick: ((event: {
      notification: { close: () => void; data: { href: string } };
      waitUntil: (promise: Promise<unknown>) => void;
    }) => void) | undefined;
    const inbox = { url: "https://crm.example/app/inbox", focus: vi.fn(async () => {}),
      navigate: vi.fn(async () => {}) };
    const webchat = { url: "https://crm.example/atendimento/123", focus: vi.fn(async () => {}),
      navigate: vi.fn(async () => {}) };
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
      waitUntil: (promise) => { pending = promise; },
    });
    await pending;
    expect(webchat.focus).toHaveBeenCalledOnce();
    expect(webchat.navigate).toHaveBeenCalledWith("https://crm.example/atendimento/123");
    expect(inbox.focus).not.toHaveBeenCalled();
  });
});
