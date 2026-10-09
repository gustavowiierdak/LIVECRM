import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { camposCpfParaGravar, hashCpf } from "@/lib/contacts/cpf";

import type { IxcCustomer } from "./client";

const MAX_TENTATIVAS = 3;

export type OrigemDoVinculoIxc = "automatico" | "atendente";

export interface VinculoIxcDoContato {
  customer_id: string;
  customer_name: string;
  linked_at: string;
  linked_by: OrigemDoVinculoIxc;
}

export type ResultadoDoVinculoIxc =
  | { ok: true; vinculo: VinculoIxcDoContato; alterado: boolean }
  | {
      ok: false;
      motivo: "contato_nao_encontrado" | "contato_anonimizado" | "vinculo_divergente" | "cpf_divergente" | "falha_ao_salvar";
    };

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

export function lerVinculoIxc(sourceMetadata: unknown): VinculoIxcDoContato | null {
  if (!sourceMetadata || typeof sourceMetadata !== "object" || Array.isArray(sourceMetadata)) return null;
  const metadata = sourceMetadata as Record<string, unknown>;
  const customer_id = texto(metadata.ixc_customer_id);
  const customer_name = texto(metadata.ixc_customer_name);
  const linked_at = texto(metadata.ixc_linked_at);
  const linked_by = texto(metadata.ixc_linked_by);
  if (!customer_id || !customer_name || !linked_at) return null;
  if (linked_by !== "automatico" && linked_by !== "atendente") return null;
  return { customer_id, customer_name, linked_at, linked_by };
}

export function nomeDoClienteIxc(cliente: IxcCustomer): string {
  return cliente.razao?.trim() || cliente.fantasia?.trim() || `Cliente IXC ${cliente.id}`;
}

interface VincularInput {
  organizationId: string;
  contactId: string;
  document: string;
  cliente: IxcCustomer;
  origem: OrigemDoVinculoIxc;
  /** Só a escolha explícita do atendente pode substituir outro cadastro. */
  permitirSubstituicao?: boolean;
  actorUserId?: string | null;
  actorAgentId?: string | null;
  requestId?: string | null;
}

/**
 * Vincula o contato ao cadastro operacional do IXC sem trocar o nome recebido
 * pelo canal. O vínculo mora em `source_metadata`, que a cascata LGPD já limpa.
 *
 * O update usa `updated_at` como compare-and-swap e relê em conflito. Sem isso,
 * uma atribuição de anúncio gravada no mesmo instante poderia ser perdida pelo
 * merge de JSON feito no aplicativo.
 */
export async function vincularContatoAoIxc(
  supabase: SupabaseClient,
  input: VincularInput,
): Promise<ResultadoDoVinculoIxc> {
  for (let tentativa = 0; tentativa < MAX_TENTATIVAS; tentativa += 1) {
    const { data: contato, error: leituraErro } = await supabase
      .from("contacts")
      .select("source_metadata,updated_at,cpf_hash,is_anonymized")
      .eq("organization_id", input.organizationId)
      .eq("id", input.contactId)
      .maybeSingle<{
        source_metadata: Record<string, unknown> | null;
        updated_at: string;
        cpf_hash: string | null;
        is_anonymized: boolean;
      }>();
    if (leituraErro) return { ok: false, motivo: "falha_ao_salvar" };
    if (!contato) return { ok: false, motivo: "contato_nao_encontrado" };
    if (contato.is_anonymized) return { ok: false, motivo: "contato_anonimizado" };

    const atual = lerVinculoIxc(contato.source_metadata);
    if (
      atual &&
      atual.customer_id !== input.cliente.id &&
      !input.permitirSubstituicao
    ) {
      return { ok: false, motivo: "vinculo_divergente" };
    }
    const cpfHash = hashCpf(input.document);
    if (contato.cpf_hash && contato.cpf_hash !== cpfHash && !input.permitirSubstituicao) {
      return { ok: false, motivo: "cpf_divergente" };
    }

    const nome = nomeDoClienteIxc(input.cliente);
    if (
      atual?.customer_id === input.cliente.id &&
      atual.customer_name === nome &&
      contato.cpf_hash === cpfHash
    ) {
      return { ok: true, vinculo: atual, alterado: false };
    }

    const agora = new Date().toISOString();
    const vinculo: VinculoIxcDoContato = {
      customer_id: input.cliente.id,
      customer_name: nome,
      linked_at: agora,
      linked_by: input.origem,
    };
    const metadata = {
      ...(contato.source_metadata ?? {}),
      ixc_customer_id: vinculo.customer_id,
      ixc_customer_name: vinculo.customer_name,
      ixc_linked_at: vinculo.linked_at,
      ixc_linked_by: vinculo.linked_by,
    };
    const camposCpf =
      contato.cpf_hash === cpfHash ? {} : await camposCpfParaGravar(supabase, input.document);
    // Numa correção manual, nunca associe o cadastro novo mantendo o hash do
    // titular anterior. Se a cifra estiver indisponível, falhar fechado evita
    // um cartão IXC e uma identidade financeira que discordam entre si.
    if (contato.cpf_hash && contato.cpf_hash !== cpfHash && !("cpf_hash" in camposCpf)) {
      return { ok: false, motivo: "falha_ao_salvar" };
    }

    const { data: atualizado, error: atualizacaoErro } = await supabase
      .from("contacts")
      .update({ source_metadata: metadata, ...camposCpf })
      .eq("organization_id", input.organizationId)
      .eq("id", input.contactId)
      .eq("updated_at", contato.updated_at)
      .select("id")
      .maybeSingle<{ id: string }>();
    if (atualizacaoErro) return { ok: false, motivo: "falha_ao_salvar" };
    if (!atualizado) continue;

    await supabase.rpc("emit_event", {
      p_event_type: "contact.ixc_linked",
      p_entity_kind: "contact",
      p_entity_id: input.contactId,
      p_payload: {
        ixc_customer_id: vinculo.customer_id,
        source: input.origem,
        replaced: !!atual && atual.customer_id !== vinculo.customer_id,
      },
      p_metadata: { request_id: input.requestId ?? null },
      p_organization_id: input.organizationId,
    });
    await audit({
      action: "contact.ixc_linked",
      actorUserId: input.actorUserId ?? null,
      organizationId: input.organizationId,
      resourceType: "contact",
      resourceId: input.contactId,
      requestId: input.requestId ?? null,
      metadata: {
        actor_agent_id: input.actorAgentId ?? null,
        source: input.origem,
        ixc_customer_id: vinculo.customer_id,
        previous_ixc_customer_id: atual?.customer_id ?? null,
      },
    });
    return { ok: true, vinculo, alterado: true };
  }
  return { ok: false, motivo: "falha_ao_salvar" };
}
