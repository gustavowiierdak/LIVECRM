import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { normalizeCpf } from "@/lib/contacts/cpf";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { buscarClienteIxc, IxcConnectionError } from "@/lib/ixc/client";
import { carregarIntegracaoIxc } from "@/lib/ixc/integration";
import { vincularContatoAoIxc } from "@/lib/ixc/vinculo-do-contato";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({
  document: z.string().transform(normalizeCpf).pipe(z.string().regex(/^\d{11}$/)),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const params = paramsSchema.safeParse(await ctx.params);
  if (!params.success) return fail("validation_error", "Contato inválido.", 400, { requestId });

  const authz = await requireRole("agent", { requestId, resource: "contacts" });
  if (!authz.ok) return authz.response;
  const supportDenied = await requireSupportWrite(authz.org.orgId);
  if (supportDenied) return supportDenied;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("validation_error", "Informe o CPF do titular.", 400, { requestId });
  }
  const body = bodySchema.safeParse(raw);
  if (!body.success) return fail("validation_error", "Informe um CPF com 11 dígitos.", 400, { requestId });

  // A sessão decide a organização e a RLS decide se este contato é visível.
  // Só depois dessa cerca o client administrativo alcança o segredo do IXC.
  const sessao = await createClient();
  const { data: contato, error: contatoErro } = await sessao
    .from("contacts")
    .select("id,is_anonymized")
    .eq("organization_id", authz.org.orgId)
    .eq("id", params.data.id)
    .maybeSingle<{ id: string; is_anonymized: boolean }>();
  if (contatoErro) return fail("internal_error", contatoErro.message, 500, { requestId });
  if (!contato) return fail("not_found", "Contato não encontrado.", 404, { requestId });
  if (contato.is_anonymized) {
    return fail("state_conflict", "Contato anonimizado não pode receber um vínculo externo.", 409, { requestId });
  }

  const admin = createAdminClient();
  const integracao = await carregarIntegracaoIxc(admin, authz.org.orgId, "customers");
  if (!integracao.ok) {
    return fail("upstream_unavailable", "A consulta de clientes do IXC não está disponível nesta organização.", 503, { requestId });
  }

  try {
    const cliente = await buscarClienteIxc(integracao.baseUrl, integracao.token, body.data.document);
    if (!cliente) return fail("not_found", "Nenhum cadastro foi encontrado no IXC para este CPF.", 404, { requestId });

    const resultado = await vincularContatoAoIxc(admin, {
      organizationId: authz.org.orgId,
      contactId: contato.id,
      document: body.data.document,
      cliente,
      origem: "atendente",
      permitirSubstituicao: true,
      actorUserId: authz.user.id,
      requestId,
    });
    if (!resultado.ok) {
      const conflito = resultado.motivo === "contato_anonimizado" || resultado.motivo === "cpf_divergente";
      return fail(
        conflito ? "state_conflict" : "internal_error",
        conflito ? "O contato mudou enquanto o vínculo era salvo. Atualize a tela e tente novamente." : "Não foi possível salvar o vínculo com o IXC.",
        conflito ? 409 : 500,
        { requestId },
      );
    }
    return ok(resultado.vinculo, { requestId });
  } catch (error) {
    if (error instanceof IxcConnectionError) {
      return fail("upstream_unavailable", "Não foi possível consultar o IXC agora. Tente novamente.", 503, { requestId });
    }
    throw error;
  }
}
