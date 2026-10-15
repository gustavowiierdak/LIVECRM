/**
 * Destinatários de avisos de conversa, não de toda mensagem gravada.
 * O comando calculado pelo banco é a mesma régua das abas Fila/Automático.
 * IA em atendimento nunca interrompe a equipe; fila avisa apenas seu setor;
 * conversa assumida avisa apenas o atendente responsável.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { orgTemAutomatico } from "@/lib/ai/agents/org-tem-automatico";
import { CONVERSATION_TERMINAL_STATUSES } from "@/lib/schemas";

export type DestinatariosDaMensagem = { tipo: "restrito"; userIds: string[] };

export interface FatosDoAviso {
  comando: string;
  atribuidoA: string | null;
  setorId: string | null;
  automaticoDaOrg?: boolean;
  membrosDoSetor: ReadonlyArray<string>;
  atendentesAtivos: ReadonlyArray<string>;
}

/** Lista vazia significa silêncio. O escopo nunca se amplia por erro de leitura. */
export function destinatariosDaMensagem(fatos: FatosDoAviso): DestinatariosDaMensagem {
  if (fatos.comando === "humano" && fatos.atribuidoA) {
    return { tipo: "restrito", userIds: [fatos.atribuidoA] };
  }
  const naFila = fatos.comando === "aguardando"
    || (fatos.comando === "automatico" && fatos.automaticoDaOrg === false);
  if (!naFila) return { tipo: "restrito", userIds: [] };

  const ativos = new Set(fatos.atendentesAtivos);
  const candidatos = fatos.setorId ? fatos.membrosDoSetor : fatos.atendentesAtivos;
  return { tipo: "restrito", userIds: [...new Set(candidatos.filter((id) => ativos.has(id)))] };
}

export function usuarioRecebeAviso(destinatarios: DestinatariosDaMensagem, userId: string): boolean {
  return destinatarios.userIds.includes(userId);
}

type Resultado<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;

export interface LeitorDeAtribuicao {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
}

/** Service role: cada leitura fica presa à organização do evento/sessão. */
export async function carregarDestinatariosDaMensagem(
  db: LeitorDeAtribuicao,
  organizationId: string,
  conversationId: string,
  _contactId: string | null = null,
): Promise<DestinatariosDaMensagem | null> {
  const conv = await (db.from("conversations")
    .select("status, assigned_to_user_id, atendimento_setor_id, comando_da_conversa")
    .eq("id", conversationId)
    .eq("organization_id", organizationId)
    .maybeSingle() as Resultado<{
      status: string;
      assigned_to_user_id: string | null;
      atendimento_setor_id: string | null;
      comando_da_conversa: string;
    }>);
  if (conv.error) throw new Error(conv.error.message);
  if (!conv.data) return null;
  if (CONVERSATION_TERMINAL_STATUSES.some((status) => status === conv.data?.status)) {
    return { tipo: "restrito", userIds: [] };
  }

  const comando = conv.data.comando_da_conversa;
  if (comando === "humano" && conv.data.assigned_to_user_id) {
    return destinatariosDaMensagem({
      comando, atribuidoA: conv.data.assigned_to_user_id,
      setorId: conv.data.atendimento_setor_id, membrosDoSetor: [], atendentesAtivos: [],
    });
  }
  if (comando !== "aguardando" && comando !== "automatico") {
    return { tipo: "restrito", userIds: [] };
  }
  const automaticoDaOrg = comando === "automatico"
    ? await orgTemAutomatico(db as SupabaseClient, organizationId)
    : undefined;
  if (comando === "automatico" && automaticoDaOrg !== false) {
    return { tipo: "restrito", userIds: [] };
  }

  const [membros, ativos] = await Promise.all([
    conv.data.atendimento_setor_id
      ? db.from("atendimento_setor_membros").select("user_id")
        .eq("organization_id", organizationId).eq("setor_id", conv.data.atendimento_setor_id) as Resultado<Array<{ user_id: string }>>
      : Promise.resolve({ data: [], error: null }),
    db.from("user_organizations").select("user_id")
      .eq("organization_id", organizationId).is("revoked_at", null)
      .in("role", ["agent", "manager", "admin"]) as Resultado<Array<{ user_id: string }>>,
  ]);
  if (membros.error) throw new Error(membros.error.message);
  if (ativos.error) throw new Error(ativos.error.message);
  return destinatariosDaMensagem({
    comando,
    atribuidoA: null,
    setorId: conv.data.atendimento_setor_id,
    automaticoDaOrg,
    membrosDoSetor: (membros.data ?? []).map((m) => m.user_id),
    atendentesAtivos: (ativos.data ?? []).map((m) => m.user_id),
  });
}
