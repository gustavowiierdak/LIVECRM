import { describe, expect, it } from "vitest";
import { precisaFilaTecnica } from "@/lib/ixc/escalacao-tecnica";

describe("evidência do cliente para fila técnica", () => {
  it.each(["LOS", "é a LOS", "A luz LOS"])(
    "encaminha %s após luz vermelha relatada pelo cliente",
    (fala) => {
      expect(precisaFilaTecnica(fala, ["Tem uma luz vermelho acesa"])).toBe(true);
    },
  );
  it.each([
    "LOS vermelha piscando",
    "LOS acesa",
    "a fibra está rompida",
    "cabo de fibra arrebentado",
  ])("encaminha evidência física: %s", (fala) => {
    expect(precisaFilaTecnica(fala, [])).toBe(true);
  });
  it.each([
    "LOS apagada",
    "LOS apagou e voltou a internet",
    "não tem luz vermelha",
    "o que é LOS?",
    "LOS",
    "sem internet",
    "obrigado",
  ])("não transforma %s em defeito físico confirmado", (fala) => {
    expect(precisaFilaTecnica(fala, [])).toBe(false);
  });
  it("não usa luz antiga de outro episódio", () => {
    expect(precisaFilaTecnica("LOS", ["luz vermelha", "voltou", "outra pergunta"])).toBe(false);
  });
});
