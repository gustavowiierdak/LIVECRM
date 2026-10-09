import { describe, expect, it } from "vitest";

import { situacaoDoContratoIxc } from "./situacao-do-contrato";

describe("situação de acesso do contrato IXC", () => {
  it("traduz CA em bloqueio financeiro quando o contrato está ativo", () => {
    expect(
      situacaoDoContratoIxc({ status: "A", status_internet: "CA", contrato_suspenso: "N" }),
    ).toEqual({ situacao: "bloqueado_financeiro", bloqueioFinanceiro: true });
  });

  it("não ressuscita bloqueio antigo de contrato inativo", () => {
    expect(
      situacaoDoContratoIxc({ status: "I", status_internet: "CA", contrato_suspenso: "N" }),
    ).toEqual({ situacao: "contrato_inativo", bloqueioFinanceiro: false });
  });

  it.each([
    ["A", "N", "ativo"],
    ["D", "N", "desativado"],
    ["A", "S", "suspenso"],
    ["X", "N", "desconhecido"],
  ] as const)("traduz acesso %s e suspensão %s", (statusInternet, suspenso, situacao) => {
    expect(
      situacaoDoContratoIxc({
        status: "A",
        status_internet: statusInternet,
        contrato_suspenso: suspenso,
      }),
    ).toEqual({ situacao, bloqueioFinanceiro: false });
  });
});
