import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import type { IxcResources } from "@/app/actions/settings/updateIxcConnection";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";

import { IxcConnectionForm, type IxcConnectionView } from "./_form";

export const metadata = { title: "IXC Provedor" };
export const dynamic = "force-dynamic";

const RECURSOS_PADRAO: IxcResources = {
  customers: true,
  contracts: true,
  receivables: true,
  service_orders: true,
};

function recursosSeguros(value: unknown): IxcResources {
  if (!value || typeof value !== "object" || Array.isArray(value)) return RECURSOS_PADRAO;
  const v = value as Record<string, unknown>;
  return {
    customers: v.customers !== false,
    contracts: v.contracts !== false,
    receivables: v.receivables !== false,
    service_orders: v.service_orders !== false,
  };
}

export default async function IxcSettingsPage() {
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
    .select("base_url,enabled,resources,last_tested_at,last_test_ok,last_test_error")
    .eq("organization_id", activeOrg.orgId)
    .eq("provider", "ixc")
    .maybeSingle();

  const conexao: IxcConnectionView | null = data
    ? {
        baseUrl: data.base_url,
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
        <h1 className="text-2xl font-semibold tracking-tight">{t("IXC Provedor")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("Conecte o IXC para preparar consultas de clientes, contratos, financeiro e ordens de serviço no atendimento e para os agentes de IA.")}
        </p>
      </header>

      <div className="max-w-3xl rounded-md border border-sky-500/40 bg-sky-500/10 p-4 text-sm">
        {t("No IXC, crie um usuário exclusivo em")} <strong>{t("Configurações do sistema → Usuários")}</strong>,
        {" "}{t("marque")} <strong>{t("Permite acesso ao webservice")}</strong>{" "}
        {t("e dê somente as permissões necessárias. O token fica criptografado e nunca volta para o navegador.")}
      </div>

      <IxcConnectionForm initial={conexao} />

      <p className="max-w-3xl text-xs text-muted-foreground">
        {t("Esta primeira etapa configura e testa a conexão. Nenhum cadastro é importado ainda; a escolha acima prepara quais grupos poderão ser liberados para a Inbox e para a IA na próxima etapa.")}
      </p>
    </div>
  );
}
