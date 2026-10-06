"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { randomId } from "@/lib/random-id";
import type { MensagemWebchat, SessaoOperadorWebchat } from "@/lib/webchat/types";
import { cn } from "@/lib/utils";

type ApiOk<T> = { data: T };
type Setor = "suporte" | "financeiro" | "cancelamento";

const SETORES: ReadonlyArray<{ value: Setor; label: string }> = [
  { value: "suporte", label: "Suporte" },
  { value: "financeiro", label: "Financeiro" },
  { value: "cancelamento", label: "Cancelamento" },
];

async function resposta<T>(response: Response): Promise<T> {
  const json = (await response.json().catch(() => null)) as
    ApiOk<T> | { error?: { message?: string } } | null;
  if (!response.ok || !json || !("data" in json)) {
    throw new Error(
      (json && "error" in json && json.error?.message) || "Não foi possível concluir a ação.",
    );
  }
  return json.data;
}

/**
 * Porta explícita do canal web na inbox. Ele nunca reutiliza nem mistura a
 * timeline do canal de origem: carrega apenas as mensagens isoladas por sessão.
 */
export function WebchatOperatorPanel({
  conversationId,
  supportReadonly = false,
  primary = false,
}: {
  conversationId: string;
  supportReadonly?: boolean;
  primary?: boolean;
}) {
  const t = useT();
  const [sessions, setSessions] = useState<SessaoOperadorWebchat[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [messages, setMessages] = useState<MensagemWebchat[]>([]);
  const [sector, setSector] = useState<Setor>("suporte");
  const [draft, setDraft] = useState("");
  const [handoffToken, setHandoffToken] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const selectedSession = sessions.find((session) => session.id === selectedSessionId);

  const loadSessions = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const next = await resposta<SessaoOperadorWebchat[]>(
          await fetch(`/api/v1/conversations/${conversationId}/webchat-sessions`, {
            credentials: "same-origin",
          }),
        );
        setSessions(next);
        setSelectedSessionId((current) =>
          next.some((session) => session.id === current)
            ? current
            : (next.find((session) => session.active)?.id ?? next[0]?.id ?? ""),
        );
        setStatus(null);
      } catch (error) {
        setStatus(
          error instanceof Error
            ? error.message
            : t("Não foi possível carregar o atendimento web."),
        );
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [conversationId, t],
  );

  const loadMessages = useCallback(async () => {
    if (!selectedSessionId) {
      setMessages([]);
      return;
    }
    try {
      const params = new URLSearchParams({ visitor_session_id: selectedSessionId });
      const next = await resposta<MensagemWebchat[]>(
        await fetch(`/api/v1/conversations/${conversationId}/webchat/messages?${params}`, {
          credentials: "same-origin",
        }),
      );
      setMessages(next);
      setStatus(null);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : t("Não foi possível carregar as mensagens."),
      );
    }
  }, [conversationId, selectedSessionId, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSessions(), 0);
    return () => window.clearTimeout(timer);
  }, [loadSessions]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadSessions(true);
    }, 7_000);
    return () => window.clearInterval(interval);
  }, [loadSessions]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadMessages(), 0);
    return () => window.clearTimeout(timer);
  }, [loadMessages]);

  useEffect(() => {
    if (!selectedSessionId) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadMessages();
    }, 7_000);
    return () => window.clearInterval(interval);
  }, [loadMessages, selectedSessionId]);

  const emitirHandoff = async () => {
    setSending(true);
    try {
      const handoff = await resposta<{ handoff_token: string; expires_at: string }>(
        await fetch(`/api/v1/conversations/${conversationId}/webchat-handoffs`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sector }),
        }),
      );
      setHandoffToken(handoff.handoff_token);
      setStatus(t("Código criado. Entregue-o pelo canal já autorizado ao cliente."));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("Não foi possível criar o código."));
    } finally {
      setSending(false);
    }
  };

  const enviar = async () => {
    const body = draft.trim();
    if (!body || !selectedSessionId) return;
    setSending(true);
    try {
      const message = await resposta<MensagemWebchat>(
        await fetch(`/api/v1/conversations/${conversationId}/webchat/messages`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            visitor_session_id: selectedSessionId,
            body,
            idempotency_key: randomId(),
          }),
        }),
      );
      setMessages((current) => [...current, message]);
      setDraft("");
      setStatus(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("Não foi possível enviar a resposta."));
    } finally {
      setSending(false);
    }
  };

  return (
    <section
      className={cn("border-t border-border bg-muted/20 px-3 py-3",
        primary && "min-h-0 flex-1 overflow-y-auto")}
      aria-label={t("Atendimento web")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{t("Atendimento web")}</h2>
          <p className="text-xs text-muted-foreground">
            {t("Canal separado: apenas mensagens trocadas neste atendimento aparecem aqui.")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void loadSessions();
            void loadMessages();
          }}
          disabled={loading}
        >
          {t("Atualizar")}
        </Button>
      </div>

      {status && (
        <p className="mt-2 text-sm text-muted-foreground" role="status">
          {status}
        </p>
      )}

      {!supportReadonly && !primary && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md border border-border bg-background p-2">
          <label
            className="grid gap-1 text-xs font-medium"
            htmlFor={`webchat-sector-${conversationId}`}
          >
            {t("Setor")}
            <select
              id={`webchat-sector-${conversationId}`}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={sector}
              onChange={(event) => setSector(event.target.value as Setor)}
            >
              {SETORES.map((item) => (
                <option key={item.value} value={item.value}>
                  {t(item.label)}
                </option>
              ))}
            </select>
          </label>
          <Button type="button" size="sm" onClick={() => void emitirHandoff()} disabled={sending}>
            {t("Gerar código de acesso")}
          </Button>
        </div>
      )}

      {handoffToken && (
        <div className="mt-2 rounded-md border border-primary/30 bg-primary/5 p-2">
          <p className="text-xs text-muted-foreground">
            {t("Mostrado uma única vez. Envie pelo canal já autorizado.")}
          </p>
          <code className="mt-1 block text-sm font-semibold break-all select-all">
            {handoffToken}
          </code>
        </div>
      )}

      {loading ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("Carregando sessões…")}</p>
      ) : sessions.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {t("Nenhum visitante conectado por este canal.")}
        </p>
      ) : (
        <div className="mt-3 grid gap-2">
          <label
            className="grid gap-1 text-xs font-medium"
            htmlFor={`webchat-session-${conversationId}`}
          >
            {t("Sessão ativa")}
            <select
              id={`webchat-session-${conversationId}`}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={selectedSessionId}
              onChange={(event) => setSelectedSessionId(event.target.value)}
            >
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {t(
                    SETORES.find((item) => item.value === session.sector)?.label ?? session.sector,
                  )}
                  {session.active ? "" : ` — ${t("Sessão encerrada")}`}
                </option>
              ))}
            </select>
          </label>
          <div
            className={cn("space-y-2 overflow-y-auto rounded-md border border-border bg-background p-2",
              primary ? "min-h-64 max-h-[55vh]" : "max-h-44")}
            aria-live="polite"
          >
            {messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("Ainda não há mensagens nesta sessão.")}
              </p>
            ) : (
              messages.map((message) => (
                <p key={message.id} className="text-sm">
                  <span className="font-medium">
                    {message.direction === "operator" ? t("Você") : t("Cliente")}:{" "}
                  </span>
                  {message.body}
                </p>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <label className="sr-only" htmlFor={`webchat-reply-${conversationId}`}>
              {t("Responder pelo atendimento web")}
            </label>
            <input
              id={`webchat-reply-${conversationId}`}
              className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={4000}
              disabled={supportReadonly || !selectedSession?.active}
              placeholder={t("Responder neste atendimento")}
            />
            <Button
              type="button"
              size="sm"
              onClick={() => void enviar()}
              disabled={supportReadonly || !selectedSession?.active || sending || !draft.trim()}
            >
              {t("Enviar")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
