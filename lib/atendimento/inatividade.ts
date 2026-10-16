import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { STATUS_OPERANTE } from "@/lib/organizacao/operante";

/** O relogio existente chama a regra transacional; sem configuracao nada muda. */
export async function acompanharInatividade(admin: SupabaseClient, requestId: string) {
  const { data: orgs, error } = await admin
    .from("organizations")
    .select("id")
    .eq("status", STATUS_OPERANTE)
    .not("settings->routing->ai_inactivity", "is", null);
  if (error) throw error;
  const total = { avisos: 0, encerrados: 0, falhas: 0 };
  for (const org of orgs ?? []) {
    const { data, error: tickError } = await admin.rpc("fn_atendimento_inatividade_tick", {
      p_org: org.id,
      p_limite: 100,
    });
    if (tickError) {
      total.falhas++;
      logger.error("[atendimento-inatividade] falha na varredura", {
        organization_id: org.id,
        code: tickError.code,
        requestId,
      });
      continue;
    }
    const result = data as { avisos: number; encerrados: number };
    total.avisos += result.avisos;
    total.encerrados += result.encerrados;
    if (result.avisos || result.encerrados) {
      await audit({
        action: "conversation.inactivity_run",
        organizationId: org.id,
        bypassedRls: true,
        metadata: result,
        requestId,
      });
    }
  }
  return total;
}
