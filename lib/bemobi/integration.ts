import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

const credencialSchema = z.object({
  version: z.literal(1),
  api_key: z.string().min(1),
  api_secret: z.string().min(1).optional(),
});

const recursosSchema = z.object({
  invoices: z.boolean().default(false),
  payment_data: z.boolean().default(false),
  invoice_pdf: z.boolean().default(false),
  secure_portal: z.boolean().default(false),
  negotiation: z.boolean().default(false),
  recurrence: z.boolean().default(false),
  checkout: z.boolean().default(false),
});

export type BemobiResource = keyof z.infer<typeof recursosSchema>;

export type BemobiIntegrationResult =
  | {
      ok: true;
      apiKey: string;
      apiSecret?: string;
      resources: z.infer<typeof recursosSchema>;
    }
  | {
      ok: false;
      reason: "not_configured" | "disabled" | "credential_unavailable" | "resource_disabled";
    };

export async function carregarIntegracaoBemobi(
  supabase: SupabaseClient,
  organizationId: string,
  resource: BemobiResource,
): Promise<BemobiIntegrationResult> {
  const { data } = await supabase
    .from("erp_integrations")
    .select("enabled,resources,credential_encrypted")
    .eq("organization_id", organizationId)
    .eq("provider", "bemobi")
    .maybeSingle();
  if (!data) return { ok: false, reason: "not_configured" };
  if (!data.enabled) return { ok: false, reason: "disabled" };

  const resources = recursosSchema.parse(data.resources ?? {});
  if (!resources[resource]) return { ok: false, reason: "resource_disabled" };

  const raw = await decryptWebhookSecret(supabase, data.credential_encrypted);
  if (!raw) return { ok: false, reason: "credential_unavailable" };
  try {
    const credencial = credencialSchema.parse(JSON.parse(raw));
    return {
      ok: true,
      apiKey: credencial.api_key,
      ...(credencial.api_secret ? { apiSecret: credencial.api_secret } : {}),
      resources,
    };
  } catch {
    return { ok: false, reason: "credential_unavailable" };
  }
}
