"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { EmojiButton } from "@/components/inbox/composer/EmojiButton";
import { NoteCard } from "@/components/inbox/NoteCard";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { useConversationNotes } from "@/hooks/inbox/useConversationNotes";
import { useCreateNote } from "@/hooks/inbox/useCreateNote";
import { randomId } from "@/lib/random-id";
import type { Note } from "@/lib/types/messaging";
import { ArrowsClockwise, CircleNotch, Globe, PaperPlaneTilt } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";
import type { MensagemWebchat, SessaoOperadorWebchat } from "@/lib/webchat/types";

type ApiOk<T> = { data: T };
type Setor = "suporte" | "financeiro" | "cancelamento";
type Modo = "reply" | "note";
type ItemDoFio =
  | { kind: "message"; createdAt: string; data: MensagemWebchat }
  | { kind: "note"; createdAt: string; data: Note };

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

function horaDaMensagem(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Porta explícita do canal web na inbox. O visual acompanha o fio comum, mas o
 * transporte continua próprio: anexos, áudio, citação e sugestão do agente só
 * entram quando o contrato do webchat souber carregá-los sem cair no WhatsApp.
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
  const [mode, setMode] = useState<Modo>("reply");
  const [handoffToken, setHandoffToken] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const notes = useConversationNotes(primary ? conversationId : null);
  const createNote = useCreateNote();

  const selectedSession = sessions.find((session) => session.id === selectedSessionId);
  const items = useMemo<ItemDoFio[]>(() => {
    const next: ItemDoFio[] = [
      ...messages.map((data) => ({ kind: "message" as const, createdAt: data.created_at, data })),
      ...(primary
        ? notes.map((data) => ({ kind: "note" as const, createdAt: data.created_at, data }))
        : []),
    ];
    return next.sort(
      (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
    );
  }, [messages, notes, primary]);

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

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [items.length, selectedSessionId]);

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
    if (!body) return;
    setSending(true);
    try {
      if (mode === "note") {
        await createNote.mutateAsync({ conversation_id: conversationId, body });
      } else {
        if (!selectedSessionId) return;
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
      }
      setDraft("");
      setStatus(null);
      if (editorRef.current) editorRef.current.style.height = "auto";
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : mode === "note"
            ? t("Não foi possível salvar a nota interna.")
            : t("Não foi possível enviar a resposta."),
      );
    } finally {
      setSending(false);
    }
  };

  function resizeEditor() {
    const editor = editorRef.current;
    if (!editor) return;
    editor.style.height = "auto";
    editor.style.height = `${Math.min(editor.scrollHeight, 160)}px`;
  }

  function onEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void enviar();
  }

  function insertEmoji(emoji: string) {
    const editor = editorRef.current;
    if (!editor) {
      setDraft((current) => current + emoji);
      return;
    }
    const start = editor.selectionStart ?? draft.length;
    const end = editor.selectionEnd ?? draft.length;
    setDraft(draft.slice(0, start) + emoji + draft.slice(end));
    window.requestAnimationFrame(() => {
      editor.focus();
      editor.selectionStart = editor.selectionEnd = start + emoji.length;
      resizeEditor();
    });
  }

  const replyDisabled =
    supportReadonly || sending || createNote.isPending || !selectedSession?.active;
  const noteDisabled = supportReadonly || sending || createNote.isPending;
  const editorDisabled = mode === "note" ? noteDisabled : replyDisabled;

  return (
    <section
      className={cn(
        "border-t border-border bg-background",
        primary ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "px-3 py-3",
      )}
      aria-label={t("Atendimento web")}
    >
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-2",
          primary && "border-b border-border px-4 py-2.5",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Globe size={17} aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{t("Atendimento web")}</h2>
            <p className="truncate text-xs text-muted-foreground">
              {t("Canal separado: apenas mensagens trocadas neste atendimento aparecem aqui.")}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size={primary ? "icon" : "sm"}
          className={primary ? "size-9" : undefined}
          onClick={() => {
            void loadSessions();
            void loadMessages();
          }}
          disabled={loading}
          aria-label={t("Atualizar")}
          title={t("Atualizar")}
        >
          {loading ? (
            <CircleNotch size={17} className="animate-spin" aria-hidden />
          ) : primary ? (
            <ArrowsClockwise size={17} aria-hidden />
          ) : (
            t("Atualizar")
          )}
        </Button>
      </div>

      {status && (
        <p
          className={cn(
            "text-sm text-muted-foreground",
            primary ? "border-b border-border bg-muted/40 px-4 py-2" : "mt-2",
          )}
          role="status"
        >
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
        <div className="flex min-h-52 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <CircleNotch size={18} className="animate-spin" aria-hidden />
          {t("Carregando sessões…")}
        </div>
      ) : sessions.length === 0 ? (
        <div className="flex min-h-52 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
          {t("Nenhum visitante conectado por este canal.")}
        </div>
      ) : (
        <div className={cn("min-h-0", primary ? "flex flex-1 flex-col" : "mt-3 grid gap-2")}>
          <label
            className={cn(
              "text-xs font-medium",
              primary
                ? "flex items-center gap-2 border-b border-border bg-muted/20 px-4 py-2"
                : "grid gap-1",
            )}
            htmlFor={`webchat-session-${conversationId}`}
          >
            <span className={primary ? "text-muted-foreground" : undefined}>
              {t("Sessão ativa")}
            </span>
            <select
              id={`webchat-session-${conversationId}`}
              className={cn(
                "h-9 rounded-md border border-input bg-background px-2 text-sm",
                primary && "min-w-0 flex-1",
              )}
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
            className={cn(
              "overflow-y-auto bg-muted/10 py-3",
              primary ? "min-h-0 flex-1" : "max-h-64 rounded-md border border-border",
            )}
            role="log"
            aria-label={t("Mensagens do atendimento")}
            aria-live="polite"
          >
            {items.length === 0 ? (
              <div className="flex min-h-44 items-center justify-center px-6 text-center text-sm text-muted-foreground">
                {t("Ainda não há mensagens nesta sessão.")}
              </div>
            ) : (
              items.map((item) =>
                item.kind === "note" ? (
                  <NoteCard key={`note:${item.data.id}`} note={item.data} />
                ) : item.data.direction === "system" ? (
                  <div
                    key={item.data.id}
                    className="flex w-full justify-center px-4 py-2"
                    role="status"
                  >
                    <span className="rounded-full border border-border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
                      {t(item.data.body)}
                    </span>
                  </div>
                ) : (
                  <div
                    key={item.data.id}
                    className={cn(
                      "flex w-full min-w-0 px-4 py-1",
                      item.data.direction === "operator" ? "justify-end" : "justify-start",
                    )}
                  >
                    <div
                      data-testid="webchat-message-bubble"
                      className={cn(
                        "max-w-[75%] min-w-0 rounded-2xl px-3 py-2 text-sm shadow-sm",
                        item.data.direction === "operator"
                          ? "rounded-br-sm bg-primary text-primary-foreground"
                          : "rounded-bl-sm bg-muted text-foreground",
                      )}
                    >
                      <p className="leading-snug wrap-anywhere whitespace-pre-wrap">
                        {item.data.body}
                      </p>
                      <div
                        className={cn(
                          "mt-1 text-right text-[10px]",
                          item.data.direction === "operator"
                            ? "text-primary-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {item.data.direction === "operator" ? t("Você") : t("Cliente")} ·{" "}
                        {horaDaMensagem(item.data.created_at)}
                      </div>
                    </div>
                  </div>
                ),
              )
            )}
            <div ref={endRef} aria-hidden />
          </div>

          <div
            className={cn(
              "border-t border-border px-3 py-2",
              mode === "note" ? "border-warning/40 bg-warning-bg" : "bg-background",
            )}
          >
            {primary && (
              <div className="mb-1.5 flex gap-1">
                <button
                  type="button"
                  onClick={() => setMode("reply")}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                    mode === "reply"
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {t("Responder")}
                </button>
                <button
                  type="button"
                  onClick={() => setMode("note")}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                    mode === "note"
                      ? "bg-warning text-warning-fg"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {t("Nota interna")}
                </button>
              </div>
            )}
            <div className="flex items-end gap-2">
              <EmojiButton disabled={editorDisabled} onPick={insertEmoji} />
              <label className="sr-only" htmlFor={`webchat-reply-${conversationId}`}>
                {t("Responder pelo atendimento web")}
              </label>
              <textarea
                ref={editorRef}
                id={`webchat-reply-${conversationId}`}
                className="max-h-40 min-h-9 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:ring-1 focus:ring-ring focus:outline-hidden"
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  resizeEditor();
                }}
                onKeyDown={onEditorKeyDown}
                rows={1}
                maxLength={4000}
                disabled={editorDisabled}
                placeholder={
                  mode === "note"
                    ? t("Escreva uma nota interna… (só o time vê)")
                    : selectedSession?.active
                      ? t("Escreva uma mensagem…")
                      : t("Sessão encerrada")
                }
                title={
                  mode === "note"
                    ? t("Enter salva a nota · Shift+Enter quebra linha")
                    : t("Enter envia · Shift+Enter quebra linha")
                }
              />
              <Button
                type="button"
                size="icon"
                className="size-9 shrink-0"
                onClick={() => void enviar()}
                disabled={editorDisabled || !draft.trim()}
                aria-label={mode === "note" ? t("Salvar nota") : t("Enviar")}
              >
                {sending || createNote.isPending ? (
                  <CircleNotch size={16} className="animate-spin" aria-hidden />
                ) : (
                  <PaperPlaneTilt size={16} weight="fill" aria-hidden />
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
