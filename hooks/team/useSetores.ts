"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import type { SetorDeAtendimento } from "@/lib/routing/setores";
import { useAuth } from "@/hooks/auth/AuthProvider";

export function useSetores(enabled = true) {
  const { activeOrg } = useAuth();
  return useQuery({
    queryKey: ["atendimento-setores", activeOrg?.orgId],
    enabled: enabled && !!activeOrg,
    queryFn: async () =>
      (await apiClient.get<{ data: SetorDeAtendimento[] }>("/api/v1/team/setores")).data,
    staleTime: 15_000,
  });
}
