"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSetores } from "@/hooks/team/useSetores";
import { useTeamMembers } from "@/hooks/team/useTeamMembers";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";

export function SetoresClient() {
  const t = useT();
  const setores = useSetores();
  const membros = useTeamMembers();
  const qc = useQueryClient();
  const [edicoes, setEdicoes] = useState<Record<string, string[]>>({});
  const salvar = useMutation({
    mutationFn: (
      input:
        | { action: "criar_padrao" }
        | { action: "salvar_membros"; setor_id: string; user_ids: string[] },
    ) => apiClient.post("/api/v1/team/setores", input),
    onSuccess: async (_data, input) => {
      await qc.invalidateQueries({ queryKey: ["atendimento-setores"] });
      if (input.action === "salvar_membros")
        setEdicoes((old) => {
          const next = { ...old };
          delete next[input.setor_id];
          return next;
        });
      toast.success(t("Setores atualizados."));
    },
    onError: showApiError,
  });
  const pessoas = (membros.data?.data ?? []).filter((m) => !m.revoked_at && m.role !== "viewer");
  if (setores.isLoading || membros.isLoading) return <p>{t("Carregando setores…")}</p>;
  if (setores.error || membros.error)
    return <p role="alert">{t("Não foi possível carregar os setores. Recarregue a página.")}</p>;
  return (
    <section className="flex flex-col gap-4" aria-label={t("Setores de atendimento")}>
      <p className="max-w-2xl text-sm text-muted-foreground">
        {t(
          "Vincule as pessoas às filas em que vão atender. Uma pessoa pode participar de mais de um setor. Sem atendentes vinculados, a conversa permanece na fila do setor para a gestão acompanhar.",
        )}
      </p>
      {!setores.data?.length && (
        <Button
          disabled={salvar.isPending}
          onClick={() => salvar.mutate({ action: "criar_padrao" })}
        >
          {t("Criar setores de atendimento")}
        </Button>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {setores.data?.map((s) => {
          const selecionados = edicoes[s.id] ?? s.user_ids;
          return (
            <Card key={s.id}>
              <CardHeader>
                <CardTitle>{s.nome}</CardTitle>
                <CardDescription>
                  {selecionados.length
                    ? `${selecionados.length} ${t("atendente(s) vinculado(s)")}`
                    : t("Sem atendentes vinculados — os clientes aguardam nesta fila.")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <fieldset className="flex flex-col gap-2">
                  <legend className="sr-only">
                    {t("Atendentes de")} {s.nome}
                  </legend>
                  {pessoas.map((p) => (
                    <label key={p.user_id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        disabled={salvar.isPending}
                        checked={selecionados.includes(p.user_id)}
                        onChange={(e) =>
                          setEdicoes((old) => ({
                            ...old,
                            [s.id]: e.target.checked
                              ? [...selecionados, p.user_id]
                              : selecionados.filter((id) => id !== p.user_id),
                          }))
                        }
                      />
                      {p.full_name ?? p.email ?? t("Atendente sem nome")}
                    </label>
                  ))}
                </fieldset>
              </CardContent>
              <CardFooter>
                <Button
                  size="sm"
                  disabled={salvar.isPending || !edicoes[s.id]}
                  onClick={() =>
                    salvar.mutate({
                      action: "salvar_membros",
                      setor_id: s.id,
                      user_ids: selecionados,
                    })
                  }
                >
                  {t("Salvar vínculos")}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
