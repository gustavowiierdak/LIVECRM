"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { provisionarEquipeProvedor } from "@/lib/ai/agents/provisionar-equipe-provedor";
import { audit } from "@/lib/audit";
import { loadAuthUser, mfaEmDivida, resolveActiveOrg } from "@/lib/auth/server";
import { podeAdministrarEmpresa } from "@/lib/auth/pode-administrar-empresa";
import { supportWriteError } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export type ProvisionProviderAgentsResult =
  | { ok: true; created: number; reused: number; total: number; router_created: boolean }
  | {
      ok: false;
      error: "unauthenticated" | "forbidden_tenant" | "forbidden_role" | "mfa_required" | "model_not_available" | "db_error";
    };

export async function provisionarAgentesDoProvedor(): Promise<ProvisionProviderAgentsResult> {
  const user = await loadAuthUser();
  if (!user) return { ok: false, error: "unauthenticated" };
  if (supportWriteError(user.support)) return { ok: false, error: "forbidden_role" };
  const org = await resolveActiveOrg(user);
  if (!org) return { ok: false, error: "forbidden_tenant" };
  if (!podeAdministrarEmpresa(user, org)) return { ok: false, error: "forbidden_role" };
  if (await mfaEmDivida()) return { ok: false, error: "mfa_required" };

  let resultado;
  try {
    resultado = await provisionarEquipeProvedor(createAdminClient(), {
      organizationId: org.orgId,
      userId: user.id,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "model_not_available") {
      return { ok: false, error: "model_not_available" };
    }
    return { ok: false, error: "db_error" };
  }

  const h = await headers();
  await audit({
    action: "ai_agent.provider_team_provisioned",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "ai_agent",
    resourceId: null,
    requestId: h.get("x-request-id") ?? undefined,
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
    userAgent: h.get("user-agent") ?? undefined,
    metadata: {
      created: resultado.created,
      reused: resultado.reused,
      total: resultado.total,
      router_created: resultado.routerCreated,
      provider: resultado.provider,
      model: resultado.model,
    },
  });
  revalidatePath("/app/settings/bemobi");
  revalidatePath("/app/ai/agents");
  return {
    ok: true,
    created: resultado.created,
    reused: resultado.reused,
    total: resultado.total,
    router_created: resultado.routerCreated,
  };
}
