/** Evidência física relatada pelo cliente, não uma menção solta a uma luz. */
export function precisaFilaTecnica(
  mensagem: string,
  anterioresDoCliente: readonly string[],
): boolean {
  const normalizar = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const atual = normalizar(mensagem.trim());
  if (/\b(?:voltou|normalizou|resolvid[oa]|apagada|apagou|nao esta|nao tem|nao e)\b/.test(atual))
    return false;
  if (
    /\b(?:fibra|cabo (?:da |de )?fibra)\b.{0,35}\b(?:rompid[oa]|partid[oa]|arrebentad[oa])\b/.test(
      atual,
    )
  )
    return true;
  if (
    /\blos\b.{0,25}\b(?:vermelh[ao]|aces[ao]|piscando)\b|\b(?:luz|led)\s+vermelh[ao].{0,25}\blos\b/.test(
      atual,
    )
  )
    return true;
  // “LOS” respondendo à identificação da luz vermelha: só falas do cliente,
  // nunca as opções que a IA enumerou nem o histórico antigo de outro problema.
  if (/^(?:e (?:a )?|a (?:luz )?)?los[.!]?$/i.test(atual)) {
    return anterioresDoCliente
      .slice(-2)
      .some(
        (s) =>
          /\b(?:luz|led)\s+vermelh[ao]\b/.test(normalizar(s)) && !/\bnao\b/.test(normalizar(s)),
      );
  }
  return false;
}
