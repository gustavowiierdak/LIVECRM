type ResultadoIxc = Record<string, unknown>;

const AUSENCIA_DE_BLOQUEIO_FINANCEIRO = [
  /\bsem\s+(?:qualquer\s+)?bloqueio\s+financeiro\b/i,
  /\bn[aã]o\s+(?:est[aá]|consta|existe|h[aá]|possui|tem|apresenta|indica|indicou|identifiquei|identificamos|encontrei)[^.?!\n]{0,100}\bbloqueio\s+financeiro\b/i,
  /\bn[aã]o\s+est[aá]\s+bloquead[oa]\s+por\s+(?:uma\s+)?pend[eê]ncia\s+financeira\b/i,
  /\bnenhum[ao]?\s+(?:bloqueio|pend[eê]ncia)\s+financeir[oa][^.?!\n]{0,60}\b(?:bloqueando|suspendendo|impedindo)\b/i,
];

function objeto(valor: unknown): ResultadoIxc | null {
  return typeof valor === "object" && valor !== null ? (valor as ResultadoIxc) : null;
}

/**
 * A ausência de bloqueio é um dado de roteamento interno: ela autoriza o
 * diagnóstico técnico, mas não acrescenta uma ação útil para o cliente.
 */
export function consultaIxcLiberouDiagnosticoTecnico(resultado: unknown): boolean {
  const r = objeto(resultado);
  return (
    r?.encontrado === true &&
    r.bloqueio_financeiro === false &&
    r.diagnostico === "sem_bloqueio_financeiro_no_ixc"
  );
}

function afirmaAusenciaDeBloqueioFinanceiro(trecho: string): boolean {
  return AUSENCIA_DE_BLOQUEIO_FINANCEIRO.some((padrao) => padrao.test(trecho));
}

/**
 * Remove apenas frases que expõem ao cliente o resultado negativo da consulta
 * financeira. O restante da resposta (perguntas e testes técnicos) é preservado.
 */
export function omitirAusenciaDeBloqueioFinanceiro(texto: string): {
  texto: string;
  removeu: boolean;
} {
  let removeu = false;
  const blocos = texto.split(/(\n+)/).map((bloco) => {
    if (/^\n+$/.test(bloco)) return bloco;
    const frases = bloco.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [bloco];
    const mantidas = frases.filter((frase) => {
      if (!afirmaAusenciaDeBloqueioFinanceiro(frase)) return true;
      removeu = true;
      return false;
    });
    return mantidas.join("").trim();
  });

  return {
    texto: blocos
      .join("")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    removeu,
  };
}
