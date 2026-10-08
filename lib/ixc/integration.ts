import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

const recursosSchema = z.object({
  customers: z.boolean().default(false),
  contracts: z.boolean().default(false),
  receivables: z.boolean().default(false),
  service_orders: z.boolean().default(false),
});

export type IxcResource = keyof z.infer<typeof recursosSchema>;
export type IxcIntegrationResult =
  | { ok: true; baseUrl: string; token: string }
  | {
      ok: false;
      reason: "not_configured" | "disabled" | "resource_disabled" | "credential_unavailable";
    };

export async function carregarIntegracaoIxc(
  supabase: SupabaseClient,
  organizationId: string,
  resource: IxcResource,
): Promise<IxcIntegrationResult> {
  const { data } = await supabase
    .from("erp_integrations")
    .select("base_url,enabled,resources,credential_encrypted")
    .eq("organization_id", organizationId)
    .eq("provider", "ixc")
    .maybeSingle();
  if (!data) return { ok: false, reason: "not_configured" };
  if (!data.enabled) return { ok: false, reason: "disabled" };
  const recursos = recursosSchema.safeParse(data.resources ?? {});
  if (!recursos.success || !recursos.data[resource])
    return { ok: false, reason: "resource_disabled" };
  const token = await decryptWebhookSecret(supabase, data.credential_encrypted);
  if (!token) return { ok: false, reason: "credential_unavailable" };
  return { ok: true, baseUrl: data.base_url, token };
}
