import type { SupabaseClient } from "@supabase/supabase-js";

export interface SetorDeAtendimento {
  id: string;
  slug: string;
  nome: string;
  user_ids: string[];
}

export async function listarSetores(
  db: SupabaseClient,
  org: string,
): Promise<SetorDeAtendimento[]> {
  const [setores, membros] = await Promise.all([
    db.from("atendimento_setores").select("id,slug,nome").eq("organization_id", org).order("nome"),
    db.from("atendimento_setor_membros").select("setor_id,user_id").eq("organization_id", org),
  ]);
  if (setores.error || membros.error) throw new Error("Não foi possível carregar os setores.");
  return (setores.data ?? []).map((s) => ({
    ...s,
    user_ids: (membros.data ?? []).filter((m) => m.setor_id === s.id).map((m) => m.user_id),
  }));
}
