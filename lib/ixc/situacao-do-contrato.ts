import type { IxcContract } from "./client";

export type SituacaoDeAcessoIxc =
  | "ativo"
  | "bloqueado_financeiro"
  | "desativado"
  | "suspenso"
  | "contrato_inativo"
  | "desconhecido";

function codigo(valor: string | null | undefined): string {
  return valor?.trim().toUpperCase() ?? "";
}

/**
 * Traduz os códigos operacionais do IXC antes que cheguem ao modelo.
 *
 * `CA` é o status de acesso "Financeiro em atraso" do contrato. O contrato
 * precisa continuar ativo: um código antigo num contrato já encerrado não pode
 * virar um diagnóstico atual para o assinante.
 */
export function situacaoDoContratoIxc(
  contrato: Pick<IxcContract, "status" | "status_internet" | "contrato_suspenso">,
): { situacao: SituacaoDeAcessoIxc; bloqueioFinanceiro: boolean } {
  const status = codigo(contrato.status);
  const acesso = codigo(contrato.status_internet);
  const suspenso = codigo(contrato.contrato_suspenso);

  if (status !== "A") {
    return { situacao: "contrato_inativo", bloqueioFinanceiro: false };
  }
  if (acesso === "CA") {
    return { situacao: "bloqueado_financeiro", bloqueioFinanceiro: true };
  }
  if (suspenso === "S") {
    return { situacao: "suspenso", bloqueioFinanceiro: false };
  }
  if (acesso === "A") {
    return { situacao: "ativo", bloqueioFinanceiro: false };
  }
  if (acesso === "D") {
    return { situacao: "desativado", bloqueioFinanceiro: false };
  }
  return { situacao: "desconhecido", bloqueioFinanceiro: false };
}
