import { describe, it, expect } from "vitest";
import { avisoDaOrdemIxc, confirmouSolucaoIxc } from "./aviso-os";

describe("avisos da O.S.", () => {
  it("avisa o agendamento sem converter o horário do IXC", () => {
    expect(
      avisoDaOrdemIxc("27", { status: "A" }, { status: "AG", data_agenda: "2026-10-15 14:00:00" })
        ?.texto,
    ).toContain("15/10/2026 às 14:00");
  });
  it("não repete estado nem agenda iguais", () => {
    const estado = { status: "AG", data_agenda: "2026-10-15 14:00:00" };
    expect(avisoDaOrdemIxc("27", estado, estado)).toBeNull();
  });
  it("avisa mudança de início e fim", () => {
    expect(
      avisoDaOrdemIxc(
        "27",
        { status: "AG", data_agenda: "2026-10-15 14:00:00" },
        {
          status: "AG",
          data_agenda: "2026-10-16 15:00:00",
          data_agenda_final: "2026-10-16 16:00:00",
        },
      )?.texto,
    ).toContain("atualizado");
  });
  it("não apresenta datas zeradas como agendamento", () => {
    expect(
      avisoDaOrdemIxc("27", { status: "A" }, { status: "AG", data_agenda: "0000-00-00 00:00:00" }),
    ).toBeNull();
  });
  it("agenda retirada não vira cancelamento da O.S.", () => {
    const aviso = avisoDaOrdemIxc(
      "27",
      { status: "AG", data_agenda: "2026-10-15 14:00:00" },
      { status: "RAG", data_agenda: "0000-00-00 00:00:00" },
    );
    expect(aviso?.texto).toContain("retirado");
    expect(aviso?.texto).not.toContain("cancelada");
  });
  it("finalização pergunta se resolveu, sem afirmar que a internet voltou", () => {
    const aviso = avisoDaOrdemIxc("27", { status: "EX" }, { status: "F" });
    expect(aviso?.tipo).toBe("finalizacao");
    expect(aviso?.texto).toContain("voltou a funcionar normalmente?");
    expect(avisoDaOrdemIxc("27", { status: "F" }, { status: "F" })).toBeNull();
  });
  it.each(["sim", "sim, voltou", "Sim, obrigado!", "voltou ao normal", "agora está funcionando"])(
    "confirmação clara: %s",
    (t) => expect(confirmouSolucaoIxc(t)).toBe(true),
  );
  it.each([
    "obrigado",
    "",
    "sim, mas continua ruim",
    "não voltou",
    "sim?",
    "pode finalizar",
    "o técnico disse resolvido",
  ])("não encerra: %s", (t) => expect(confirmouSolucaoIxc(t)).toBe(false));
});
