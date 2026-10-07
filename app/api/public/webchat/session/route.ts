import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import {
  WEBCHAT_SESSION_COOKIE,
  digestWebchat,
  origemDeLeituraWebchat,
} from "@/lib/webchat/seguranca";
import type { SessaoVisitanteWebchat } from "@/lib/webchat/types";
import { createAdminClient } from "@/lib/supabase/admin";

type ClienteRpc = {
  rpc: (
    name: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const raw = (await cookies()).get(WEBCHAT_SESSION_COOKIE)?.value;
  const origin = origemDeLeituraWebchat(request);
  if (!raw) return fail("unauthenticated", "Sessão de atendimento ausente.", 401, { requestId });
  const admin = createAdminClient() as unknown as ClienteRpc;
  const { data, error } = await admin.rpc("fn_webchat_sessao_visitante", {
    p_session_digest: digestWebchat(raw),
    p_origin: origin,
  });
  const resultado = data as Partial<SessaoVisitanteWebchat & { ok: boolean }> | null;
  if (
    error ||
    !resultado?.ok ||
    !resultado.expires_at ||
    !resultado.sector ||
    typeof resultado.active !== "boolean"
  )
    return fail("unauthenticated", "Sessão expirada.", 401, { requestId });
  const requestedPublicId = request.headers.get("x-webchat-public-id");
  if (requestedPublicId && requestedPublicId !== resultado.public_id)
    return fail("unauthenticated", "Sessão de outro atendimento.", 401, { requestId });
  return ok(
    {
      sector: resultado.sector,
      expires_at: resultado.expires_at,
      public_id: resultado.public_id,
      active: resultado.active,
      closed_at: resultado.closed_at ?? null,
    },
    { requestId },
  );
}
