import type { Metadata } from "next";

import { PortalDeAtendimento } from "@/components/atendimento/PortalDeAtendimento";
import { marcaDaSaida } from "@/lib/branding/saida";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";

export const metadata: Metadata = {
  title: "Atendimento",
  robots: { index: false, follow: false },
};

/**
 * Entrada pública visual, sem leitura ou escrita do CRM.
 *
 * A página só ganha uma conversa depois de existir a sessão opaca de visitante:
 * ela não recebe telefone, token de API, id de organização ou histórico na URL.
 */
export default async function AtendimentoPage() {
  // A marca vem da instalação; nenhum clone novo deve herdar a marca da Live.
  const marca = await marcaDaSaida(null);
  const idioma = await idiomaDoVisitante(null);

  return (
    <IdiomaProvider locale={idioma}>
      <PortalDeAtendimento marca={marca.nome} logoUrl={marca.logoUrl} accent={marca.accent} />
    </IdiomaProvider>
  );
}
