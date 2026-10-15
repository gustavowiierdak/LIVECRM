import { describe, expect, it } from "vitest";
import { mergeThreadItems } from "@/components/inbox/ChatThread";

describe("mergeThreadItems", () => {
  const cartao = (id: string, criadoEm: string) => ({ id, criadoEm }) as never;

  it("mantém mensagens sem inserir observações internas no chat", () => {
    const msgs = [
      { id: "m1", sent_at: "2026-07-23T10:00:00Z" },
      { id: "m2", sent_at: "2026-07-23T10:02:00Z" },
    ] as never;
    expect(mergeThreadItems(msgs).map((item) => item.data.id)).toEqual(["m1", "m2"]);
    expect(mergeThreadItems(msgs).every((item) => item.kind === "message")).toBe(true);
  });

  it("intercala os cartões de passagem na ordem do atendimento", () => {
    const msgs = [
      { id: "m1", sent_at: "2026-09-18T10:00:00Z" },
      { id: "m2", sent_at: "2026-09-18T10:05:00Z" },
    ] as never;
    const out = mergeThreadItems(msgs, [cartao("p1", "2026-09-18T10:02:00Z")]);
    expect(out.map((item) => item.data.id)).toEqual(["m1", "p1", "m2"]);
    expect(out[1]?.kind).toBe("passagem");
  });

  it("no mesmo instante, a passagem vem depois da fala que a causou", () => {
    const msgs = [{ id: "m1", sent_at: "2026-09-18T10:00:00Z" }] as never;
    expect(mergeThreadItems(msgs, [cartao("p1", "2026-09-18T10:00:00Z")])
      .map((item) => item.data.id)).toEqual(["m1", "p1"]);
  });

  it("aceita conversa sem mensagens e sem passagens", () => {
    expect(mergeThreadItems([])).toEqual([]);
    expect(mergeThreadItems([], [cartao("p1", "2026-09-18T10:00:00Z")])[0]?.kind).toBe("passagem");
  });
});
