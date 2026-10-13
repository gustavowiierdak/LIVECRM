"use client";
import { useSetores } from "@/hooks/team/useSetores";
import { Badge } from "@/components/ui/badge";

export function SetorDaConversa({ id }: { id?: string | null }) {
  return id ? <SetorIdentificado id={id} /> : null;
}

function SetorIdentificado({ id }: { id: string }) {
  const { data } = useSetores();
  const setor = data?.find((s) => s.id === id);
  return setor ? <Badge variant="outline">{setor.nome}</Badge> : null;
}
