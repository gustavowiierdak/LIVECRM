"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/auth/AuthProvider";

import { EmojiButton } from "@/components/inbox/composer/EmojiButton";
import { MessageFrame } from "@/components/inbox/MessageFrame";
import { CitacaoWebchat } from "@/components/atendimento/CitacaoWebchat";
import { DocumentCard } from "@/components/inbox/media/DocumentCard";
import { ImageMedia } from "@/components/inbox/media/ImageMedia";
import { AudioPlayer } from "@/components/inbox/media/AudioPlayer";
import { pdfDaMensagem } from "@/lib/webchat/anexo";
import { tipoDeAnexoWebchat } from "@/lib/webchat/media";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { randomId } from "@/lib/random-id";
import { ArrowBendUpLeft, ArrowsClockwise, CaretDown, CircleNotch, Globe, PaperPlaneTilt, X } from "@/lib/ui/icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { AtendimentoOperadorWebchat, MensagemWebchat } from "@/lib/webchat/types";

type ApiOk<T> = { data: T };
type Setor = "suporte" | "financeiro" | "cancelamento";
const SEM_MENSAGENS: MensagemWebchat[] = [];

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

function horaDaMensagem(value: string, locale: string): string {
  return new Date(value).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
}

/**
 * Porta explícita do canal web na inbox. O visual acompanha o fio comum, mas o
 * transporte continua próprio: imagem e áudio do visitante são carregados pelo
 * contrato do webchat sem misturar as mensagens do WhatsApp.
 */
export function WebchatOperatorPanel({
  conversationId,
  supportReadonly = false,
  primary = false,
  contactName,
}: {
  conversationId: string;
  supportReadonly?: boolean;
  primary?: boolean;
  contactName?: string | null;
}) {
  const t = useT();
  const locale = useTagDeIdioma();
  const { user, activeOrg } = useAuth();
  const qc = useQueryClient();
  const [requestedSessionId, setSelectedSessionId] = useState("");
  // Cache só em memória, isolado por usuário/org/conversa/sessão. Ao voltar,
  // mostra o fio já lido e revalida: não descarta tudo a cada clique na lista.
  const queryKey = ["webchat-attendance", user.id, activeOrg?.orgId, conversationId, requestedSessionId] as const;
  const attendance = useQuery({
    queryKey,
    enabled: !!activeOrg?.orgId,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 7_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const params = requestedSessionId ? `?${new URLSearchParams({ visitor_session_id: requestedSessionId })}` : "";
      return resposta<AtendimentoOperadorWebchat>(await fetch(
        `/api/v1/conversations/${conversationId}/webchat/attendance${params}`,
        { credentials: "same-origin", signal },
      ));
    },
  });
  const sessions = attendance.data?.sessions ?? [];
  const selectedSessionId = attendance.data?.selected_session_id ?? "";
  const messages = attendance.data?.messages ?? SEM_MENSAGENS;
  const [sector, setSector] = useState<Setor>("suporte");
  const [draft, setDraft] = useState("");
  const [quoted, setQuoted] = useState<{ sessionId: string; message: MensagemWebchat } | null>(null);
  const replyTo = quoted?.sessionId === selectedSessionId ? quoted.message : null;
  const [handoffToken, setHandoffToken] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const loading = attendance.isPending;
  const [sending, setSending] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const focusReplyRef = useRef(false);
  const sendAttemptRef = useRef<{ signature: string; key: string } | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const selectedSession = sessions.find((session) => session.id === selectedSessionId);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length, selectedSessionId]);

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
      const signature = JSON.stringify([selectedSessionId, body, replyTo?.id ?? null]);
      if (sendAttemptRef.current?.signature !== signature) {
        sendAttemptRef.current = { signature, key: randomId() };
      }
      const message = await resposta<MensagemWebchat>(
        await fetch(`/api/v1/conversations/${conversationId}/webchat/messages`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            visitor_session_id: selectedSessionId,
            body,
            idempotency_key: sendAttemptRef.current.key,
            ...(replyTo ? { reply_to_message_id: replyTo.id } : {}),
          }),
        }),
      );
      // Não deixar uma leitura anterior ao envio apagar a resposta confirmada.
      await qc.cancelQueries({ queryKey });
      qc.setQueryData<AtendimentoOperadorWebchat>(queryKey, (current) => current
        ? { ...current, messages: [...current.messages.filter((item) => item.id !== message.id), message] }
        : current);
      void qc.invalidateQueries({ queryKey: ["webchat-attendance", user.id, activeOrg?.orgId, conversationId] });
      sendAttemptRef.current = null;
      setDraft("");
      setQuoted(null);
      setStatus(null);
      if (editorRef.current) editorRef.current.style.height = "auto";
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : t("Não foi possível enviar a resposta."),
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

  const editorDisabled = supportReadonly || sending || !selectedSession?.active;

  return (
    <section
      className={cn(
        "crm-webchat-operator border-t border-border bg-background",
        primary ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "px-3 py-3",
      )}
      aria-label={t("Atendimento web")}
    >
      <div
        className={cn(
          "crm-webchat-channel flex flex-wrap items-center justify-between gap-2",
          primary && "border-b border-border px-4 py-2.5",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Globe size={17} aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{t("Atendimento web")}</h2>
            <p className="crm-channel-description truncate text-xs text-muted-foreground">
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
            void attendance.refetch();
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

      {(status || attendance.error) && (
        <p
          className={cn(
            "text-sm text-muted-foreground",
            primary ? "border-b border-border bg-muted/40 px-4 py-2" : "mt-2",
          )}
          role="status"
        >
          {status ?? attendance.error?.message}
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
          {(!primary || sessions.length > 1 || !sessions[0]?.active) && <label
            className={cn(
              "crm-webchat-session text-xs font-medium",
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
              onChange={(event) => { setSelectedSessionId(event.target.value); setQuoted(null); }}
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
          </label>}

          <div
            className={cn(
              "overflow-y-auto bg-muted/10 py-3",
              primary ? "min-h-0 flex-1" : "max-h-64 rounded-md border border-border",
            )}
            role="log"
            aria-label={t("Mensagens do atendimento")}
            aria-live="polite"
          >
            {messages.length === 0 ? (
              <div className="flex min-h-44 items-center justify-center px-6 text-center text-sm text-muted-foreground">
                {t("Ainda não há mensagens nesta sessão.")}
              </div>
            ) : (
              messages.map((message) =>
                message.direction === "system" ? (
                  <div
                    key={message.id}
                    className="flex w-full justify-center px-4 py-2"
                    role="status"
                  >
                    <span className="rounded-full border border-border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
                      {t(message.body)}
                    </span>
                  </div>
                ) : (
                  <MessageFrame
                    key={message.id}
                    outbound={message.direction === "operator"}
                    ai={message.sender_kind === "ai"}
                    sender={message.direction === "operator"
                      ? message.sender_kind === "ai" ? t("IA") : message.sender_name?.trim() || t("Atendente")
                      : contactName?.trim() || t("Cliente")}
                  >
                    <div
                      data-testid="webchat-message-bubble"
                      className={cn(
                        "crm-chat-bubble max-w-full min-w-0 rounded-lg px-3 py-2 text-sm shadow-sm",
                        message.direction === "operator"
                          ? "crm-chat-outgoing rounded-br-sm bg-primary text-primary-foreground"
                          : "crm-chat-incoming rounded-bl-sm bg-card text-foreground",
                      )}
                    >
                      {!editorDisabled && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button type="button" variant="ghost" size="icon" className="float-right -mr-1 -mt-1 size-11 lg:size-7" aria-label={t("Opções da mensagem")}>
                              <CaretDown size={14} aria-hidden />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" onCloseAutoFocus={(event) => {
                            if (!focusReplyRef.current) return;
                            event.preventDefault();
                            focusReplyRef.current = false;
                            editorRef.current?.focus();
                          }}>
                            <DropdownMenuItem onSelect={() => {
                              focusReplyRef.current = true;
                              setQuoted({ sessionId: selectedSessionId, message });
                            }}>
                              <ArrowBendUpLeft size={16} aria-hidden />{t("Responder citando")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                      {message.reply_to && <CitacaoWebchat citacao={message.reply_to} visitorName={contactName} />}
                      <p className="leading-snug wrap-anywhere whitespace-pre-wrap">
                        {message.body}
                      </p>
                      {tipoDeAnexoWebchat(message) === "image" && (
                        <ImageMedia messageId={message.id} alt={t("Imagem recebida")} />
                      )}
                      {tipoDeAnexoWebchat(message) === "audio" && (
                        <AudioPlayer messageId={message.id} isOutbound={message.direction === "operator"} />
                      )}
                      {pdfDaMensagem(message) && (
                        <DocumentCard messageId={message.id} mime={message.media_mime ?? null}
                          sizeBytes={null} storagePath={null} src={pdfDaMensagem(message) ?? undefined}
                          isOutbound={message.direction === "operator"} />
                      )}
                      <div
                        className={cn(
                          "crm-message-meta mt-1 text-right text-[10px] tabular-nums",
                          message.direction === "operator"
                            ? "text-primary-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        <time dateTime={message.created_at}>{horaDaMensagem(message.created_at, locale)}</time>
                      </div>
                    </div>
                  </MessageFrame>
                ),
              )
            )}
            <div ref={endRef} aria-hidden />
          </div>

          <div
            data-mode="reply"
            className="crm-composer border-t border-border bg-background px-3 py-2"
          >
            {replyTo && (
              <div role="region" aria-label={t("Respondendo à mensagem")} className="relative mt-2 pr-12 lg:pr-9">
                <CitacaoWebchat citacao={{ ...replyTo, direction: replyTo.direction === "operator" ? "operator" : "visitor", body: replyTo.body.slice(0, 1000) }} visitorName={contactName} />
                <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0 size-11 lg:size-8" disabled={sending} aria-label={t("Cancelar citação")} onClick={() => { setQuoted(null); editorRef.current?.focus(); }}>
                  <X size={16} aria-hidden />
                </Button>
              </div>
            )}
            <div className="crm-composer-editor">
              <div className="crm-composer-tools"><EmojiButton disabled={editorDisabled} onPick={insertEmoji} /></div>
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
                placeholder={selectedSession?.active ? t("Escreva uma mensagem…") : t("Sessão encerrada")}
                title={t("Enter envia · Shift+Enter quebra linha")}
              />
              <Button
                type="button"
                size="icon"
                className="crm-composer-send size-9 shrink-0"
                onClick={() => void enviar()}
                disabled={editorDisabled || !draft.trim()}
                aria-label={t("Enviar")}
              >
                {sending ? (
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
