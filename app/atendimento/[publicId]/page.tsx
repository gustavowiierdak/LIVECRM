import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { PortalDeAtendimento } from "@/components/atendimento/PortalDeAtendimento";
import { marcaDaSaida } from "@/lib/branding/saida";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";
import { createAdminClient } from "@/lib/supabase/admin";
import { setorWebchatSchema } from "@/lib/webchat/seguranca";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Atendimento", robots: { index: false, follow: false } };

/** O ID do link é público, mas só a configuração ativa decide qual org atende. */
export default async function AtendimentoPublicoPage({
  params,
}: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  if (!z.uuid().safeParse(publicId).success) notFound();
  const admin = createAdminClient() as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string | boolean) => {
          eq: (column: string, value: string | boolean) => {
            maybeSingle: () => Promise<{ data: { organization_id: string; allowed_sectors: unknown } | null }>;
          };
        };
      };
    };
  };
  const { data } = await admin.from("webchat_channel_configs")
    .select("organization_id,allowed_sectors").eq("public_id", publicId).eq("enabled", true).maybeSingle();
  if (!data) notFound();
  const setores = z.array(setorWebchatSchema).min(1).safeParse(data.allowed_sectors);
  if (!setores.success) notFound();
  const [marca, idioma] = await Promise.all([
    marcaDaSaida(data.organization_id), idiomaDoVisitante(null),
  ]);
  return (
    <IdiomaProvider locale={idioma}>
      <PortalDeAtendimento
        marca={marca.nome} logoUrl={marca.logoUrl} accent={marca.accent}
        publicId={publicId}
        setoresPermitidos={setores.data}
      />
    </IdiomaProvider>
  );
}
