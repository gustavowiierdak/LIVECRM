"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { loadAuthUser, mfaEmDivida, resolveActiveOrg } from "@/lib/auth/server";
import { podeAdministrarEmpresa } from "@/lib/auth/pode-administrar-empresa";
import {
  BEMOBI_BASE_URL,
  BemobiConnectionError,
  testarConexaoBemobi,
  type BemobiErrorCode,
} from "@/lib/bemobi/client";
import { supportWriteError } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptWebhookSecret, encryptWebhookSecret } from "@/lib/webhooks/secrets";

const recursosSchema = z.object({
  invoices: z.boolean(),
  payment_data: z.boolean(),
  invoice_pdf: z.boolean(),
  secure_portal: z.boolean(),
  negotiation: z.boolean(),
  recurrence: z.boolean(),
  checkout: z.boolean(),
});

const entradaSchema = z.object({
  api_key: z.string().trim().min(8).max(4000).optional(),
  api_secret: z.string().trim().min(8).max(4000).optional(),
  enabled: z.boolean(),
  resources: recursosSchema,
});

const testeSchema = z.object({
  document: z.string().trim().min(11).max(32),
});

const credencialSchema = z.object({
  version: z.literal(1),
  api_key: z.string().min(1),
  api_secret: z.string().min(1).optional(),
});

export type BemobiResources = z.infer<typeof recursosSchema>;
export type BemobiConnectionInput = z.infer<typeof entradaSchema>;
export type BemobiActionError =
  | "validation_failed"
  | "unauthenticated"
  | "forbidden_tenant"
  | "forbidden_role"
  | "mfa_required"
  | "cifra_indisponivel"
  | "credencial_indisponivel"
  | "secret_required"
  | "not_configured"
  | "disabled"
  | "erro_ao_gravar"
  | BemobiErrorCode;

export type BemobiActionResult =
  | { ok: true; total?: number }
  | { ok: false; error: BemobiActionError; message?: string };

async function contextoAdministrativo(exigirMfa: boolean) {
  const user = await loadAuthUser();
  if (!user) return { ok: false as const, error: "unauthenticated" as const };
  if (supportWriteError(user.support)) return { ok: false as const, error: "forbidden_role" as const };
  const org = await resolveActiveOrg(user);
  if (!org) return { ok: false as const, error: "forbidden_tenant" as const };
  if (!podeAdministrarEmpresa(user, org)) {
    return { ok: false as const, error: "forbidden_role" as const };
  }
  if (exigirMfa && (await mfaEmDivida())) {
    return { ok: false as const, error: "mfa_required" as const };
  }
  return { ok: true as const, user, org };
}

async function contextoDaAuditoria() {
  const h = await headers();
  return {
    requestId: h.get("x-request-id") ?? undefined,
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
    userAgent: h.get("user-agent") ?? undefined,
  };
}

function lerCredencial(raw: string | null): z.infer<typeof credencialSchema> | null {
  if (!raw) return null;
  try {
    const parsed = credencialSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function salvarConexaoBemobi(
  input: BemobiConnectionInput,
): Promise<BemobiActionResult> {
  const parsed = entradaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation_failed" };

  const ctx = await contextoAdministrativo(true);
  if (!ctx.ok) return ctx;
  const admin = createAdminClient();
  const { data: existente, error: erroLeitura } = await admin
    .from("erp_integrations")
    .select("id,credential_encrypted")
    .eq("organization_id", ctx.org.orgId)
    .eq("provider", "bemobi")
    .maybeSingle();
  if (erroLeitura) return { ok: false, error: "erro_ao_gravar" };

  let guardada: z.infer<typeof credencialSchema> | null = null;
  if (existente) {
    guardada = lerCredencial(await decryptWebhookSecret(admin, existente.credential_encrypted));
    if (!guardada) return { ok: false, error: "credencial_indisponivel" };
  }
  const apiKey = parsed.data.api_key || guardada?.api_key;
  const apiSecret = parsed.data.api_secret || guardada?.api_secret;
  if (!apiKey) return { ok: false, error: "validation_failed" };
  if (parsed.data.resources.checkout && !apiSecret) {
    return { ok: false, error: "secret_required" };
  }

  const credencial = JSON.stringify({
    version: 1,
    api_key: apiKey,
    ...(apiSecret ? { api_secret: apiSecret } : {}),
  });
  const cifrada = await encryptWebhookSecret(admin, credencial);
  if (!cifrada) return { ok: false, error: "cifra_indisponivel" };

  const credencialMudou = Boolean(parsed.data.api_key || parsed.data.api_secret || !existente);
  const { error } = await admin.from("erp_integrations").upsert(
    {
      organization_id: ctx.org.orgId,
      provider: "bemobi",
      base_url: BEMOBI_BASE_URL,
      credential_encrypted: cifrada,
      enabled: parsed.data.enabled,
      resources: parsed.data.resources,
      updated_by: ctx.user.id,
      ...(credencialMudou
        ? { last_tested_at: null, last_test_ok: null, last_test_error: null }
        : {}),
    },
    { onConflict: "organization_id,provider" },
  );
  if (error) return { ok: false, error: "erro_ao_gravar" };

  await audit({
    action: "erp_integration.updated",
    actorUserId: ctx.user.id,
    organizationId: ctx.org.orgId,
    resourceType: "erp_integrations",
    resourceId: existente?.id ?? null,
    ...(await contextoDaAuditoria()),
    metadata: {
      provider: "bemobi",
      primeira_conexao: !existente,
      api_key_trocada: Boolean(parsed.data.api_key),
      api_secret_trocada: Boolean(parsed.data.api_secret),
      enabled: parsed.data.enabled,
      resources: Object.keys(parsed.data.resources).filter(
        (key) => parsed.data.resources[key as keyof BemobiResources],
      ),
    },
  });
  revalidatePath("/app/settings/bemobi");
  return { ok: true };
}

export async function testarConexaoBemobiSalva(input: {
  document: string;
}): Promise<BemobiActionResult> {
  const parsed = testeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_document" };

  const ctx = await contextoAdministrativo(false);
  if (!ctx.ok) return ctx;
  const admin = createAdminClient();
  const { data: conexao, error } = await admin
    .from("erp_integrations")
    .select("id,enabled,credential_encrypted")
    .eq("organization_id", ctx.org.orgId)
    .eq("provider", "bemobi")
    .maybeSingle();
  if (error) return { ok: false, error: "erro_ao_gravar" };
  if (!conexao) return { ok: false, error: "not_configured" };
  if (!conexao.enabled) return { ok: false, error: "disabled" };

  const credencial = lerCredencial(
    await decryptWebhookSecret(admin, conexao.credential_encrypted),
  );
  if (!credencial) return { ok: false, error: "credencial_indisponivel" };

  let resultado: BemobiActionResult;
  try {
    const teste = await testarConexaoBemobi(credencial.api_key, parsed.data.document);
    resultado = { ok: true, total: teste.total };
  } catch (falha) {
    const conhecida =
      falha instanceof BemobiConnectionError
        ? falha
        : new BemobiConnectionError("connection_failed", "Não foi possível alcançar a Bemobi.");
    resultado = { ok: false, error: conhecida.code, message: conhecida.message };
  }

  const mensagem = resultado.ok ? null : (resultado.message ?? resultado.error).slice(0, 500);
  await admin
    .from("erp_integrations")
    .update({
      last_tested_at: new Date().toISOString(),
      last_test_ok: resultado.ok,
      last_test_error: mensagem,
      updated_by: ctx.user.id,
    })
    .eq("id", conexao.id)
    .eq("organization_id", ctx.org.orgId);

  await audit({
    action: "erp_integration.tested",
    actorUserId: ctx.user.id,
    organizationId: ctx.org.orgId,
    resourceType: "erp_integrations",
    resourceId: conexao.id,
    ...(await contextoDaAuditoria()),
    // O documento consultado é deliberadamente omitido.
    metadata: { provider: "bemobi", success: resultado.ok },
  });
  revalidatePath("/app/settings/bemobi");
  return resultado;
}

export async function desconectarBemobi(): Promise<BemobiActionResult> {
  const ctx = await contextoAdministrativo(true);
  if (!ctx.ok) return ctx;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("erp_integrations")
    .delete()
    .eq("organization_id", ctx.org.orgId)
    .eq("provider", "bemobi")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: "erro_ao_gravar" };

  await audit({
    action: "erp_integration.deleted",
    actorUserId: ctx.user.id,
    organizationId: ctx.org.orgId,
    resourceType: "erp_integrations",
    resourceId: data?.id ?? null,
    ...(await contextoDaAuditoria()),
    metadata: { provider: "bemobi" },
  });
  revalidatePath("/app/settings/bemobi");
  return { ok: true };
}
