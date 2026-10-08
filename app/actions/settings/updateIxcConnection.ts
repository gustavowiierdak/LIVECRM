"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { loadAuthUser, mfaEmDivida, resolveActiveOrg } from "@/lib/auth/server";
import { podeAdministrarEmpresa } from "@/lib/auth/pode-administrar-empresa";
import { supportWriteError } from "@/lib/impersonate/support";
import {
  IxcConnectionError,
  normalizarBaseIxc,
  testarConexaoIxc,
  type IxcErrorCode,
} from "@/lib/ixc/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptWebhookSecret, encryptWebhookSecret } from "@/lib/webhooks/secrets";

const recursosSchema = z.object({
  customers: z.boolean(),
  contracts: z.boolean(),
  receivables: z.boolean(),
  service_orders: z.boolean(),
});

const entradaSchema = z.object({
  base_url: z.string().trim().min(1).max(500),
  token: z.string().trim().min(3).max(4000).optional(),
  enabled: z.boolean(),
  resources: recursosSchema,
});

export type IxcResources = z.infer<typeof recursosSchema>;
export type IxcConnectionInput = z.infer<typeof entradaSchema>;
export type IxcActionError =
  | "validation_failed"
  | "unauthenticated"
  | "forbidden_tenant"
  | "forbidden_role"
  | "mfa_required"
  | "cifra_indisponivel"
  | "credencial_indisponivel"
  | "not_configured"
  | "erro_ao_gravar"
  | IxcErrorCode;

export type IxcActionResult =
  | { ok: true; total?: number | null }
  | { ok: false; error: IxcActionError; message?: string };

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

export async function salvarConexaoIxc(input: IxcConnectionInput): Promise<IxcActionResult> {
  const parsed = entradaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation_failed" };

  let baseUrl: string;
  try {
    baseUrl = normalizarBaseIxc(parsed.data.base_url);
  } catch (error) {
    if (error instanceof IxcConnectionError) {
      return { ok: false, error: error.code, message: error.message };
    }
    return { ok: false, error: "invalid_url" };
  }

  const ctx = await contextoAdministrativo(true);
  if (!ctx.ok) return ctx;
  const admin = createAdminClient();
  const { data: existente, error: erroLeitura } = await admin
    .from("erp_integrations")
    .select("id,base_url")
    .eq("organization_id", ctx.org.orgId)
    .eq("provider", "ixc")
    .maybeSingle();
  if (erroLeitura) return { ok: false, error: "erro_ao_gravar" };
  if (!existente && !parsed.data.token) return { ok: false, error: "validation_failed" };

  const valores: Record<string, unknown> = {
    organization_id: ctx.org.orgId,
    provider: "ixc",
    base_url: baseUrl,
    enabled: parsed.data.enabled,
    resources: parsed.data.resources,
    updated_by: ctx.user.id,
  };
  if (parsed.data.token) {
    const cifrado = await encryptWebhookSecret(admin, parsed.data.token);
    if (!cifrado) return { ok: false, error: "cifra_indisponivel" };
    valores.credential_encrypted = cifrado;
  }
  if (!existente || existente.base_url !== baseUrl || parsed.data.token) {
    valores.last_tested_at = null;
    valores.last_test_ok = null;
    valores.last_test_error = null;
  }

  const { error } = await admin
    .from("erp_integrations")
    .upsert(valores, { onConflict: "organization_id,provider" });
  if (error) return { ok: false, error: "erro_ao_gravar" };

  await audit({
    action: "erp_integration.updated",
    actorUserId: ctx.user.id,
    organizationId: ctx.org.orgId,
    resourceType: "erp_integrations",
    resourceId: existente?.id ?? null,
    ...(await contextoDaAuditoria()),
    metadata: {
      provider: "ixc",
      primeira_conexao: !existente,
      token_trocado: Boolean(parsed.data.token),
      enabled: parsed.data.enabled,
      resources: Object.keys(parsed.data.resources).filter(
        (key) => parsed.data.resources[key as keyof IxcResources],
      ),
    },
  });
  revalidatePath("/app/settings/ixc");
  return { ok: true };
}

export async function testarConexaoIxcSalva(): Promise<IxcActionResult> {
  const ctx = await contextoAdministrativo(false);
  if (!ctx.ok) return ctx;
  const admin = createAdminClient();
  const { data: conexao, error } = await admin
    .from("erp_integrations")
    .select("id,base_url,credential_encrypted")
    .eq("organization_id", ctx.org.orgId)
    .eq("provider", "ixc")
    .maybeSingle();
  if (error) return { ok: false, error: "erro_ao_gravar" };
  if (!conexao) return { ok: false, error: "not_configured" };

  const token = await decryptWebhookSecret(admin, conexao.credential_encrypted);
  if (!token) return { ok: false, error: "credencial_indisponivel" };

  let resultado: IxcActionResult;
  try {
    const teste = await testarConexaoIxc(conexao.base_url, token);
    resultado = { ok: true, total: teste.total };
  } catch (falha) {
    const conhecida =
      falha instanceof IxcConnectionError
        ? falha
        : new IxcConnectionError("connection_failed", "Não foi possível alcançar o IXC.");
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
    metadata: { provider: "ixc", success: resultado.ok },
  });
  revalidatePath("/app/settings/ixc");
  return resultado;
}

export async function desconectarIxc(): Promise<IxcActionResult> {
  const ctx = await contextoAdministrativo(true);
  if (!ctx.ok) return ctx;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("erp_integrations")
    .delete()
    .eq("organization_id", ctx.org.orgId)
    .eq("provider", "ixc")
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
    metadata: { provider: "ixc" },
  });
  revalidatePath("/app/settings/ixc");
  return { ok: true };
}
