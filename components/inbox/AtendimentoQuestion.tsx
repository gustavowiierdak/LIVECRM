"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";

/** Consulta interna: lê só o histórico do atendimento selecionado. */
export function AtendimentoQuestion({ conversationId }: { conversationId: string }) {
  const t = useT();
  const [pergunta, setPergunta] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [resposta, setResposta] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function perguntar() {
    const texto = pergunta.trim();
    if (texto.length < 2 || carregando) return;
    setCarregando(true);
    setResposta(null);
    setErro(null);
    try {
      const res = await apiClient.post<{ data: { resposta: string } }>(
        `/api/v1/conversations/${conversationId}/ask`,
        { pergunta: texto },
      );
      setResposta(res.data.resposta);
    } catch (error) {
      setErro(
        error instanceof ApiError && error.message
          ? error.message
          : t("Não foi possível consultar este atendimento agora."),
      );
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="space-y-2" data-testid="pergunta-atendimento">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void perguntar();
        }}
      >
        <Input
          value={pergunta}
          onChange={(event) => setPergunta(event.target.value)}
          placeholder={t("O que aconteceu com este cliente?")}
          aria-label={t("Perguntar sobre este atendimento")}
          className="h-8 min-w-0 text-xs"
          maxLength={1000}
        />
        <Button type="submit" size="sm" disabled={pergunta.trim().length < 2 || carregando}>
          {carregando ? t("Consultando…") : t("Perguntar")}
        </Button>
      </form>
      <p className="text-[11px] text-muted-foreground">
        {t("A resposta considera as mensagens deste atendimento e não é enviada ao cliente.")}
      </p>
      {erro && (
        <p role="alert" className="text-xs text-destructive">
          {erro}
        </p>
      )}
      {resposta && (
        <div
          role="status"
          className="rounded-md border border-border bg-surface p-2 text-xs leading-relaxed whitespace-pre-wrap"
        >
          {resposta}
        </div>
      )}
    </div>
  );
}
