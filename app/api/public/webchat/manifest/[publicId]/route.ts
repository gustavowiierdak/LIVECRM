import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { manifestDoAtendimento } from "@/lib/webchat/manifest";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ publicId: string }> }): Promise<Response> {
  const { publicId } = await params;
  if (!z.uuid().safeParse(publicId).success) return new Response(null, { status: 404 });
  const { data } = await createAdminClient().from("webchat_channel_configs")
    .select("organization_id").eq("public_id", publicId).eq("enabled", true).maybeSingle();
  if (!data) return new Response(null, { status: 404 });
  return Response.json(await manifestDoAtendimento(data.organization_id, `/atendimento/${publicId}`), {
    headers: { "content-type": "application/manifest+json", "cache-control": "no-store" },
  });
}
