/** Mantém a normalização usada nos hashes existentes, sem armazenar documento em claro. */
export function normalizarDocumentoIxc(valor: string): string {
  return valor.replace(/[.\-/\s]/g, "");
}

export function documentoIxcValido(valor: string): boolean {
  return /^(?:\d{11}|\d{14})$/.test(normalizarDocumentoIxc(valor));
}

export function formatarDocumentoIxc(valor: string): string {
  const digitos = normalizarDocumentoIxc(valor);
  return digitos.length === 14
    ? digitos.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
    : digitos.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
}
