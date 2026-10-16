import { describe, expect, it } from "vitest";

import {
  elegibilidadeDesbloqueioConfiancaIxc,
  situacaoDoContratoIxc,
} from "./situacao-do-contrato";

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

describe("desbloqueio de confiança", () => {
  const contrato = {
    status: "A",
    status_internet: "CA",
    contrato_suspenso: "N",
    desbloqueio_confianca: "P",
    desbloqueio_confianca_ativo: "N",
    restricao_auto_desbloqueio: "N",
  };

  it("oferece quando o contrato bloqueado herda o padrão e não tem restrição", () => {
    expect(elegibilidadeDesbloqueioConfiancaIxc(contrato)).toEqual({
      configuracao: "padrao_da_empresa",
      utilizando_agora: false,
      restricao_auto_desbloqueio: false,
      disponivel_para_solicitar: true,
      motivo: "disponivel",
    });
  });

  it.each([
    [{ restricao_auto_desbloqueio: "S" }, "restricao_ativa"],
    [{ desbloqueio_confianca_ativo: "S" }, "ja_utilizando"],
    [{ desbloqueio_confianca: "N" }, "desabilitado_no_contrato"],
    [{ status_internet: "A" }, "sem_bloqueio_financeiro"],
  ] as const)("recusa %j", (alteracao, motivo) => {
    expect(elegibilidadeDesbloqueioConfiancaIxc({ ...contrato, ...alteracao })).toMatchObject({
      disponivel_para_solicitar: false,
      motivo,
    });
  });
});
