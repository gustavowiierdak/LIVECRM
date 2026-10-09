import type { IxcContract } from "./client";

export type SituacaoDeAcessoIxc =
  | "ativo"
  | "bloqueado_financeiro"
  | "desativado"
  | "suspenso"
  | "contrato_inativo"
  | "desconhecido";

export type ConfiguracaoDesbloqueioConfiancaIxc =
  "habilitado" | "desabilitado" | "padrao_da_empresa" | "desconhecido";

export interface ElegibilidadeDesbloqueioConfiancaIxc {
  configuracao: ConfiguracaoDesbloqueioConfiancaIxc;
  utilizando_agora: boolean | null;
  restricao_auto_desbloqueio: boolean | null;
  disponivel_para_solicitar: boolean;
  motivo:
    | "disponivel"
    | "contrato_inativo"
    | "sem_bloqueio_financeiro"
    | "desabilitado_no_contrato"
    | "ja_utilizando"
    | "restricao_ativa"
    | "dados_insuficientes";
}

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

/**
 * Traduz os três campos que controlam o botão de desbloqueio de confiança.
 *
 * `P` significa que o contrato herda o padrão da empresa. O IXC ainda refaz as
 * validações globais (dias, quantidade de títulos e intervalo entre usos) no
 * endpoint de ação; por isso este resultado autoriza OFERECER e SOLICITAR, não
 * substituir o veredito final devolvido pelo próprio IXC.
 */
export function elegibilidadeDesbloqueioConfiancaIxc(
  contrato: Pick<
    IxcContract,
    | "status"
    | "status_internet"
    | "contrato_suspenso"
    | "desbloqueio_confianca"
    | "desbloqueio_confianca_ativo"
    | "restricao_auto_desbloqueio"
  >,
): ElegibilidadeDesbloqueioConfiancaIxc {
  const acesso = situacaoDoContratoIxc(contrato);
  const configuracaoCodigo = codigo(contrato.desbloqueio_confianca);
  const configuracao: ConfiguracaoDesbloqueioConfiancaIxc =
    configuracaoCodigo === "S"
      ? "habilitado"
      : configuracaoCodigo === "N"
        ? "desabilitado"
        : configuracaoCodigo === "P"
          ? "padrao_da_empresa"
          : "desconhecido";
  const usandoCodigo = codigo(contrato.desbloqueio_confianca_ativo);
  const utilizandoAgora = usandoCodigo === "S" ? true : usandoCodigo === "N" ? false : null;
  const restricaoCodigo = codigo(contrato.restricao_auto_desbloqueio);
  const restricao = restricaoCodigo === "S" ? true : restricaoCodigo === "N" ? false : null;

  const base = {
    configuracao,
    utilizando_agora: utilizandoAgora,
    restricao_auto_desbloqueio: restricao,
  };
  if (codigo(contrato.status) !== "A") {
    return { ...base, disponivel_para_solicitar: false, motivo: "contrato_inativo" };
  }
  if (!acesso.bloqueioFinanceiro) {
    return { ...base, disponivel_para_solicitar: false, motivo: "sem_bloqueio_financeiro" };
  }
  if (configuracao === "desabilitado") {
    return { ...base, disponivel_para_solicitar: false, motivo: "desabilitado_no_contrato" };
  }
  if (utilizandoAgora === true) {
    return { ...base, disponivel_para_solicitar: false, motivo: "ja_utilizando" };
  }
  if (restricao === true) {
    return { ...base, disponivel_para_solicitar: false, motivo: "restricao_ativa" };
  }
  if (
    (configuracao !== "habilitado" && configuracao !== "padrao_da_empresa") ||
    utilizandoAgora === null ||
    restricao === null
  ) {
    return { ...base, disponivel_para_solicitar: false, motivo: "dados_insuficientes" };
  }
  return { ...base, disponivel_para_solicitar: true, motivo: "disponivel" };
}
