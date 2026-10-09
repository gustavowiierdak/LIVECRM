import "server-only";

import { cache } from "react";

import { resolveBranding } from "@/lib/branding";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

import type { MarcaResolvida } from "./resolve";
import { marcaResolvidaDaSaida } from "./saida";

type OrganizacaoDaFachada = {
  readonly id: string;
  readonly display_name: string;
};

const avisosRegistrados = new Set<string>();

function avisarUmaVez(chave: string, contexto: Record<string, unknown>): void {
  if (avisosRegistrados.has(chave)) return;
  avisosRegistrados.add(chave);
  logger.warn(
    "marca da fachada: não foi possível decidir uma organização única; vale a instalação",
    contexto,
  );
}

/**
 * Resolve a marca pública das telas de acesso.
 *
 * Uma instalação dedicada, com UMA organização ativa, pode anunciar a empresa
 * antes do login sem ambiguidade: o logo vem de `settings.branding` e o texto
 * vem de `organizations.display_name`. Em uma instalação multi-tenant, escolher
 * a primeira linha seria vazamento de identidade entre clientes; nesse caso a
 * fachada conserva a marca da instalação.
 *
 * Só `id` e `display_name` são lidos na varredura global. O restante da marca é
 * resolvido por `marcaResolvidaDaSaida(id)`, que busca apenas a organização
 * escolhida e devolve também a rampa dos dois temas para o CSS. O limite de duas
 * linhas é suficiente para distinguir
 * "única" de "ambígua" sem varrer todos os tenants.
 */
async function resolverMarcaDaFachada(): Promise<MarcaResolvida> {
  const marcaDaInstalacao = marcaResolvidaDaSaida(null);

  try {
    const consulta = createAdminClient()
      .from("organizations")
      .select("id, display_name")
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(2);

    const [fallback, { data, error }] = await Promise.all([marcaDaInstalacao, consulta]);
    if (error) {
      avisarUmaVez(`leitura|${error.code ?? "?"}`, {
        codigo: error.code,
        detalhe: error.message,
      });
      return fallback;
    }

    const organizacoes = (data ?? []) as OrganizacaoDaFachada[];
    if (organizacoes.length !== 1) return fallback;

    const organizacao = organizacoes[0]!;
    const marca = await marcaResolvidaDaSaida(organizacao.id);
    const nomeDeExibicao = organizacao.display_name.trim();
    if (!nomeDeExibicao) return marca;

    return {
      ...marca,
      ...resolveBranding(nomeDeExibicao, marca.logoUrl),
      origens: { ...marca.origens, nome: "organizacao.display_name" },
    };
  } catch (erro) {
    avisarUmaVez("leitura|excecao", {
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
    return marcaDaInstalacao;
  }
}

/** Uma resolução por render, compartilhada pelo layout público e pela página. */
export const marcaDaFachada = cache(resolverMarcaDaFachada);
