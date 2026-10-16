export interface EstadoOrdemIxc {
  status: string;
  data_agenda?: string | null;
  data_agenda_final?: string | null;
}

/** Data local do IXC, sem reinterpretar como UTC nem inventar duração. */
function agenda(valor?: string | null): string | null {
  const m = valor?.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?$/);
  if (
    !m ||
    Number(m[1]) < 2000 ||
    Number(m[2]) < 1 ||
    Number(m[2]) > 12 ||
    Number(m[3]) < 1 ||
    Number(m[3]) > 31 ||
    Number(m[4]) > 23 ||
    Number(m[5]) > 59
  )
    return null;
  return `${m[3]}/${m[2]}/${m[1]} às ${m[4]}:${m[5]}`;
}

export function avisoDaOrdemIxc(id: string, anterior: EstadoOrdemIxc, atual: EstadoOrdemIxc) {
  if (atual.status === "F" && anterior.status !== "F") {
    return {
      tipo: "finalizacao" as const,
      texto: `A equipe registrou a finalização da O.S. ${id}. A sua internet voltou a funcionar normalmente? Só vamos encerrar este atendimento depois da sua confirmação.`,
    };
  }
  if (atual.status === "F") return null;
  const inicio = agenda(atual.data_agenda);
  const anteriorInicio = agenda(anterior.data_agenda);
  const fim = agenda(atual.data_agenda_final);
  const anteriorFim = agenda(anterior.data_agenda_final);
  if (inicio === anteriorInicio && fim === anteriorFim) return null;
  if (!inicio && !anteriorInicio) return null;
  return {
    tipo: "agenda" as const,
    texto: !inicio
      ? `O agendamento da O.S. ${id} foi retirado do IXC. A equipe precisa confirmar uma nova data; ainda não há horário confirmado.`
      : `${anteriorInicio ? "O horário da visita foi atualizado" : "A visita foi agendada"} no IXC para ${inicio}${fim ? `, com término previsto em ${fim}` : ""} (O.S. ${id}). Se precisar alterar, me avise para encaminhar à equipe.`,
  };
}

/** Só confirmação inequívoca. Cortesia, silêncio e “sim, mas...” não resolvem. */
export function confirmouSolucaoIxc(texto: string): boolean {
  const t = texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.! ,]+/g, " ")
    .trim();
  return /^(?:sim|sim voltou|sim resolveu|sim esta funcionando|voltou|voltou ao normal|voltou a funcionar|esta funcionando|agora esta funcionando|resolvido|problema resolvido)(?: (?:obrigad[oa]|valeu))?$/.test(
    t,
  );
}
