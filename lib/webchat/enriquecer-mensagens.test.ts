import { describe, expect, it, vi } from "vitest";
import { enriquecerMensagensWebchat } from "./enriquecer-mensagens";

const original = { id: "33333333-3333-4333-8333-333333333333", direction: "visitor", body: "Mensagem citada", created_at: "2026-10-15T12:00:00+00:00" };
const message = { id: "reply", direction: "operator" as const, body: "Resposta", created_at: "2026-10-15T12:01:00Z" };
function database(metadata: unknown) {
  const result = { data: [{ id: message.id, metadata }], error: null };
  const query = { select: vi.fn(), eq: vi.fn(), in: vi.fn(async () => result) };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return { query, client: { from: () => query } as never };
}

describe("citação no histórico web público e autenticado", () => {
  it("reconstrói a citação persistida com uma leitura escopada e não expõe outros metadados", async () => {
    const db = database({ segredo: "não devolver", webchat_reply: { ...original, organization_id: "privado" } });
    const result = await enriquecerMensagensWebchat(db.client, "org", "sessao", [message]);
    expect(result).toEqual([{ ...message, reply_to: original }]);
    expect(db.query.eq).toHaveBeenCalledWith("organization_id", "org");
    expect(db.query.eq).toHaveBeenCalledWith("visitor_session_id", "sessao");
    expect(db.query.in).toHaveBeenCalledTimes(1);
  });
  it("ignora citação malformada sem perder a mídia da mensagem", async () => {
    const db = database({ webchat_reply: { ...original, direction: "system" }, webchat_media: { kind: "image", mime: "image/png" } });
    expect(await enriquecerMensagensWebchat(db.client, "org", "sessao", [message])).toEqual([{ ...message, type: "image", media_mime: "image/png" }]);
  });
});
