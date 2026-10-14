import { marcaDaSaida } from "@/lib/branding/saida";

export async function manifestDoAtendimento(organizationId: string | null, startUrl: string) {
  const marca = await marcaDaSaida(organizationId);
  return {
    id: startUrl,
    name: `${marca.nome} — Atendimento`,
    short_name: marca.nome,
    start_url: startUrl,
    scope: "/atendimento",
    display: "standalone",
    background_color: "#ffffff",
    icons: [
      { src: "/app-icon/192", sizes: "192x192", type: "image/png" },
      { src: "/app-icon/512", sizes: "512x512", type: "image/png" },
    ],
  };
}
