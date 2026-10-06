import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { setorWebchatSchema } from "@/lib/webchat/seguranca";
import type { ConfiguracaoWebchat } from "@/lib/webchat/types";

const origemSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.origin === value &&
    (url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))
  );
}, "Informe uma origem HTTPS exata, sem caminho ou barra final.");

const configSchema = z
  .object({
    enabled: z.boolean(),
    allowed_sectors: z.array(setorWebchatSchema).max(3),
    allowed_origins: z.array(origemSchema).max(10),
    handoff_ttl_seconds: z.number().int().min(60).max(3600),
  })
  .strict()
  .refine(
    (value) =>
      !value.enabled || (value.allowed_sectors.length > 0 && value.allowed_origins.length > 0),
    "Escolha ao menos um setor e uma origem antes de ligar o canal.",
  );

type Config = z.infer<typeof configSchema> & ConfiguracaoWebchat;
const DEFAULT_CONFIG: Config = {
  enabled: false,
  allowed_sectors: [],
  allowed_origins: [],
  handoff_ttl_seconds: 900,
};

type Query = {
  eq: (
    column: string,
    value: string,
  ) => {
    maybeSingle: () => Promise<{ data: Config | null; error: { message: string } | null }>;
  };
};
type ConfigTable = {
  select: (columns: string) => Query;
  upsert: (
    row: Config & { organization_id: string },
    options: { onConflict: string },
  ) => Promise<{ error: { message: string } | null }>;
};

function tabela() {
  // A tipagem do banco é gerada; ela só recebe esta tabela após regeneração do schema.
  const client = createAdminClient() as unknown as { from: (table: string) => ConfigTable };
  return client.from("webchat_channel_configs");
}

/** Configuração pela tela do gerente; a linha não existe até o primeiro salvamento. */
export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "settings_webchat" });
  if (!authz.ok) return authz.response;
  const { data, error } = await tabela()
    .select("enabled,allowed_sectors,allowed_origins,handoff_ttl_seconds,public_id")
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (error)
    return fail("internal_error", "Não foi possível ler o atendimento web.", 500, { requestId });
  return ok(data ?? DEFAULT_CONFIG, { requestId });
}

export async function PATCH(request: NextRequest): Promise<Response> {
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "settings_webchat" });
  if (!authz.ok) return authz.response;
  const parsed = configSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return fail("validation_error", "Configuração do atendimento web inválida.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors,
    });
  const config = {
    ...parsed.data,
    allowed_sectors: [...new Set(parsed.data.allowed_sectors)],
    allowed_origins: [...new Set(parsed.data.allowed_origins)],
  };
  const { error } = await tabela().upsert(
    { ...config, organization_id: authz.org.orgId },
    { onConflict: "organization_id" },
  );
  if (error)
    return fail("internal_error", "Não foi possível salvar o atendimento web.", 500, { requestId });
  const { data: saved, error: readError } = await tabela()
    .select("public_id")
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (readError || !saved?.public_id)
    return fail("internal_error", "Atendimento salvo, mas o link não pôde ser lido.", 500, { requestId });
  void audit({
    action: "webchat.config_updated",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "organization",
    resourceId: authz.org.orgId,
    requestId,
    metadata: {
      enabled: config.enabled,
      allowed_sectors: config.allowed_sectors,
      origins_count: config.allowed_origins.length,
      handoff_ttl_seconds: config.handoff_ttl_seconds,
    },
  });
  return ok({ ...config, public_id: saved.public_id }, { requestId });
}
