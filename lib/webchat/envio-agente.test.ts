import { describe, expect, it, vi } from "vitest";

import { chaveWebchatDoEnvio, enviarMensagemWebchatAgente } from "./envio-agente";

describe("saída do agente pelo webchat", () => {
  it("usa chave UUID determinística sem perder a chave financeira original", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, message_id: "m-1" }, error: null });
    const single = vi.fn().mockResolvedValue({ data: { id: "m-1", status: "sent" }, error: null });
    const query = { select: vi.fn(), eq: vi.fn(), single };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const supabase = { rpc, from: vi.fn().mockReturnValue(query) };
    const original = "bemobi:uma-chave-estavel";
    const ctx = { organization_id: "org", actor: { type: "ai_agent", id: "agente" },
      requestId: "request", internalMessageId: "message-uuid",
      serviceBoundary: { service_revision: 4 } };
    const input = { conversation_id: "conversa", type: "text", body: "Segue o PIX",
      metadata: { idempotency_key: original } };
    await expect(enviarMensagemWebchatAgente(supabase as never, ctx as never, input as never, "id,status"))
      .resolves.toMatchObject({ id: "m-1", status: "sent" });
    expect(chaveWebchatDoEnvio(original)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(rpc).toHaveBeenCalledWith("fn_enviar_mensagem_webchat_agente", expect.objectContaining({
      p_idempotency_key: chaveWebchatDoEnvio(original),
      p_service_revision: 4,
      p_metadata: expect.objectContaining({ idempotency_key: original }),
    }));
    expect(supabase.from).toHaveBeenCalledWith("messages");
  });

  it("não permite que um ator externo use a saída da IA", async () => {
    const supabase = { rpc: vi.fn() };
    await expect(enviarMensagemWebchatAgente(supabase as never,
      { organization_id: "org", actor: { type: "api_token", id: "token" }, requestId: "r" } as never,
      { conversation_id: "conversa", type: "text", body: "oi" } as never, "id"))
      .rejects.toMatchObject({ status: 422 });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
