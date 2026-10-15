import { vetoReason } from "@/lib/leads/veto-activity";

const OLD_OPT_OUT_REASON = "Não enviei: o contato pediu para parar de receber mensagens";

interface Activity {
  type?: string;
  reason?: string | null;
  payload?: unknown;
  [key: string]: unknown;
}

interface ContactFlags {
  is_blocked?: boolean | null;
  force_human?: boolean | null;
  is_personal?: boolean | null;
}

/** Corrige apenas a apresentação de registros antigos; não altera a auditoria. */
export function corrigirMotivoDeVetoLegado<T extends Activity>(activity: T, flags: ContactFlags): T {
  if (activity.type !== "send_vetoed" || activity.reason !== OLD_OPT_OUT_REASON) return activity;
  const payload = activity.payload as { gate?: unknown; code?: unknown } | null;
  if (payload?.gate !== "stop" || payload.code !== "contato_bloqueado") return activity;
  if (flags.is_blocked === true) return activity;
  const code = flags.is_personal === true
    ? "contato_pessoal"
    : flags.force_human === true
      ? "automatico_pausado_para_humano"
      : "parada_automatica_sem_motivo";
  return { ...activity, reason: vetoReason("stop", code) };
}
