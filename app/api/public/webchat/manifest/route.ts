import { manifestDoAtendimento } from "@/lib/webchat/manifest";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json(await manifestDoAtendimento(null, "/atendimento"), {
    headers: { "content-type": "application/manifest+json", "cache-control": "no-store" },
  });
}
