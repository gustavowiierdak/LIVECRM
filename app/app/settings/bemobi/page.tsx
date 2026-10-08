import { redirect } from "next/navigation";

import type { BemobiResources } from "@/app/actions/settings/updateBemobiConnection";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";

import { BemobiConnectionForm, type BemobiConnectionView } from "./_form";

export const metadata = { title: "Bemobi / 7AZ" };
export const dynamic = "force-dynamic";

const RECURSOS_PADRAO: BemobiResources = {
  invoices: true,
  payment_data: true,
  invoice_pdf: true,
  secure_portal: true,
  negotiation: false,
  recurrence: false,
  checkout: false,
};

function recursosSeguros(value: unknown): BemobiResources {
  if (!value || typeof value !== "object" || Array.isArray(value)) return RECURSOS_PADRAO;
  const v = value as Record<string, unknown>;
  return {
    invoices: v.invoices !== false,
    payment_data: v.payment_data !== false,
    invoice_pdf: v.invoice_pdf !== false,
    secure_portal: v.secure_portal !== false,
    negotiation: v.negotiation === true,
    recurrence: v.recurrence === true,
    checkout: v.checkout === true,
  };
}

export default async function BemobiSettingsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (!(user.is_platform_admin && !user.support) && ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }

  const admin = createAdminClient();
  const t = (texto: string) => traduzir(texto, user.idioma);
  const { data } = await admin
    .from("erp_integrations")
    .select("enabled,resources,last_tested_at,last_test_ok,last_test_error")
    .eq("organization_id", activeOrg.orgId)
    .eq("provider", "bemobi")
    .maybeSingle();
  const { count: teamCount } = await admin
    .from("ai_agents")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", activeOrg.orgId)
    .is("archived_at", null)
    .contains("config", { provisioning_origin: "telecom_blueprint_v1" });

  const conexao: BemobiConnectionView | null = data
    ? {
        enabled: data.enabled,
        resources: recursosSeguros(data.resources),
        lastTestedAt: data.last_tested_at,
        lastTestOk: data.last_test_ok,
        lastTestError: data.last_test_error,
      }
    : null;

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header className="max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">{t("Bemobi / 7AZ")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("Conecte a Bemobi para consultar faturas e preparar PIX, boleto, PDF e links de pagamento no atendimento.")}
        </p>
      </header>

      <div className="max-w-3xl rounded-md border border-sky-500/40 bg-sky-500/10 p-4 text-sm">
        {t("As consultas usam somente a API oficial da 7AZ. A chave e o segredo ficam criptografados e nunca voltam para o navegador ou para o histórico da conversa.")}
      </div>

      <BemobiConnectionForm initial={conexao} teamCount={teamCount ?? 0} />

      <p className="max-w-3xl text-xs text-muted-foreground">
        {t("IXC continua sendo a fonte de cliente, contrato, bloqueio e suporte. Nesta conexão, a Bemobi é a fonte de faturas e meios de pagamento.")}
      </p>
    </div>
  );
}
