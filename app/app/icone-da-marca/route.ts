import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { iconeBolinha } from "@/lib/branding/icone-bolinha";
import { corDoIconeDaOrganizacao } from "@/lib/branding/icone";
import { marcaResolvidaDaSaida } from "@/lib/branding/saida";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await loadAuthUser();
  if (!user) return new Response(null, { status: 401 });
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return new Response(null, { status: 404 });

  const marca = await marcaResolvidaDaSaida(activeOrg.orgId);
  return iconeBolinha(corDoIconeDaOrganizacao(marca), "private, no-store");
}
