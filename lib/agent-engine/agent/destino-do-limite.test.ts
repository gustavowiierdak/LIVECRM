import { describe, expect, it, vi } from "vitest";

import { destinoDoLimiteDaAutomacao } from "./destino-do-limite";

const org = "11111111-1111-4111-8111-111111111111";
const conversa = "22222222-2222-4222-8222-222222222222";

describe("destino humano quando a IA não pode continuar", () => {
  it("mantém o setor da conversa web, sem reclassificar pelo tipo do caso", async () => {
    const query = vi.fn(async () => ({ rows: [{ id: "setor-suporte", nome: "Suporte Técnico" }] }));
    const destino = await destinoDoLimiteDaAutomacao({ query } as never, org, conversa, "outro");
    expect(destino).toEqual({ setorId: "setor-suporte", setorNome: "Suporte Técnico" });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["financeiro", "cobranca"],
    ["agendamento", "agendamento"],
    ["problema", "suporte-tecnico"],
    ["acesso", "suporte-tecnico"],
    ["outro", "sac"],
  ])("usa %s para localizar a fila %s quando a conversa não tem setor", async (kind, slug) => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "setor", nome: "Fila" }] });
    expect(await destinoDoLimiteDaAutomacao({ query } as never, org, conversa, kind)).toEqual({
      setorId: "setor", setorNome: "Fila",
    });
    expect(query.mock.calls[1]?.[1]).toEqual([org, slug]);
  });

  it("ainda encaminha à fila geral se o setor específico não estiver configurado", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    expect(await destinoDoLimiteDaAutomacao({ query } as never, org, conversa, "financeiro"))
      .toEqual({});
  });
});
