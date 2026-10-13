import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { ok, fail } from "@/lib/api/wrappers";
import { createAdminClient } from "@/lib/supabase/admin";
import { verificarOrdensAcompanhadas } from "@/lib/ixc/acompanhamento-os";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
async function handle(req: NextRequest) {
  const requestId = randomUUID();
  if (!autorizaCron(req))
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  try {
    return ok(await verificarOrdensAcompanhadas(createAdminClient()), { requestId });
  } catch {
    return fail("internal_error", "Não foi possível acompanhar as O.S. nesta rodada.", 500, {
      requestId,
    });
  }
}
export const GET = handle;
export const POST = handle;
