"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleHelp, CircleX, Menu, Plus, Send, ShieldCheck, WalletCards } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { randomId } from "@/lib/random-id";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { MensagemWebchat } from "@/lib/webchat/types";

type SetorId = "suporte" | "financeiro" | "cancelamento";

type Setor = {
  readonly id: SetorId;
  readonly titulo: string;
  readonly descricao: string;
  readonly Icone: typeof CircleHelp;
};

const SETORES = [
  {
    id: "suporte",
    titulo: "Suporte técnico",
    descricao: "Internet, Wi-Fi e equipamentos.",
    Icone: CircleHelp,
  },
  {
    id: "financeiro",
    titulo: "Financeiro",
    descricao: "Faturas, pagamentos e segunda via.",
    Icone: WalletCards,
  },
  {
    id: "cancelamento",
    titulo: "Cancelamento",
    descricao: "Solicite o encerramento do seu plano.",
    Icone: CircleX,
  },
] as const satisfies readonly Setor[];

function tituloDoSetor(id: SetorId, t: (texto: string) => string): string {
  if (id === "financeiro") return t("Financeiro");
  if (id === "cancelamento") return t("Cancelamento");
  return t("Suporte técnico");
}

function descricaoDoSetor(id: SetorId, t: (texto: string) => string): string {
  if (id === "financeiro") return t("Faturas, pagamentos e segunda via.");
  if (id === "cancelamento") return t("Solicite o encerramento do seu plano.");
  return t("Internet, Wi-Fi e equipamentos.");
}

function PainelDeSetores({
  setores,
  setorAtual,
  onEscolher,
  ativo,
  ocupado,
  podeIniciarNovo,
  onNovo,
  t,
}: {
  readonly setores: readonly Setor[];
  readonly setorAtual: SetorId;
  readonly onEscolher: (setor: SetorId) => void;
  readonly ativo: boolean;
  readonly ocupado: boolean;
  readonly podeIniciarNovo: boolean;
  readonly onNovo: () => void;
  readonly t: (texto: string) => string;
}) {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-base font-semibold tracking-tight text-text">
          {t("Como podemos ajudar?")}
        </p>
        <p className="mt-1.5 text-sm leading-6 text-text-muted">
          {ativo
            ? podeIniciarNovo
              ? t(
                  "Você está conversando com este setor. Para escolher outro assunto, inicie um novo atendimento.",
                )
              : t("Este é o assunto definido para sua conversa atual.")
            : t("Escolha o assunto para iniciar o atendimento correto.")}
        </p>
      </div>
      {ativo && podeIniciarNovo ? (
        <Button
          type="button"
          onClick={onNovo}
          disabled={ocupado}
          className="w-full gap-2 bg-[var(--atendimento-accent)] text-white hover:opacity-90"
        >
          <Plus size={18} aria-hidden />
          {t("Novo atendimento")}
        </Button>
      ) : null}
      <div className="space-y-2.5" role="list" aria-label={t("Setores de atendimento")}>
        {(ativo ? setores.filter((item) => item.id === setorAtual) : setores).map(
          ({ id, Icone }) => {
            const selecionado = id === setorAtual;
            return (
              <div key={id} role="listitem">
                {ativo ? (
                  <div className="flex w-full items-start gap-3 rounded-2xl border border-[var(--atendimento-accent)] bg-[var(--atendimento-accent-soft)] p-4">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--atendimento-accent)] text-white">
                      <Icone size={19} aria-hidden />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-text">
                        {tituloDoSetor(id, t)}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-text-muted">
                        {descricaoDoSetor(id, t)}
                      </span>
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    aria-pressed={selecionado}
                    onClick={() => onEscolher(id)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-colors",
                      "focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden",
                      selecionado
                        ? "border-[var(--atendimento-accent)] bg-[var(--atendimento-accent-soft)]"
                        : "border-border bg-surface hover:border-[var(--atendimento-accent)] hover:bg-surface-elevated",
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-10 shrink-0 place-items-center rounded-xl",
                        selecionado
                          ? "bg-[var(--atendimento-accent)] text-white"
                          : "bg-surface-elevated text-text-muted",
                      )}
                    >
                      <Icone size={19} aria-hidden />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-text">
                        {tituloDoSetor(id, t)}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-text-muted">
                        {descricaoDoSetor(id, t)}
                      </span>
                    </span>
                  </button>
                )}
              </div>
            );
          },
        )}
      </div>
    </div>
  );
}

function PainelDeStatus({ setor, ativo }: { readonly setor: Setor; readonly ativo: boolean }) {
  const t = useT();
  return (
    <aside className="flex h-full flex-col border-l border-border bg-surface px-6 py-7">
      <p className="text-base font-semibold tracking-tight text-text">{t("Seu atendimento")}</p>
      <div className="mt-6 rounded-2xl border border-border bg-surface-elevated p-5">
        <div className="flex items-center gap-3 text-sm font-semibold text-text">
          <span
            className={cn("size-2.5 rounded-full", ativo ? "bg-emerald-400" : "bg-text-subtle")}
            aria-hidden
          />
          {ativo ? t("Conectado ao atendimento") : t("Aguardando identificação")}
        </div>
        <p className="mt-3 text-sm leading-6 text-text-muted">
          {ativo
            ? t("Esta conversa acontece somente nesta página de atendimento.")
            : t("Escolha um assunto e envie sua primeira mensagem para começar.")}
        </p>
      </div>
      <div className="mt-6 border-t border-border pt-5">
        <p className="text-xs font-semibold tracking-[0.12em] text-text-subtle uppercase">
          {ativo ? t("Assunto atual") : t("Assunto escolhido")}
        </p>
        <p className="mt-2 text-sm font-medium text-text">{tituloDoSetor(setor.id, t)}</p>
        <p className="mt-1 text-xs leading-5 text-text-muted">{descricaoDoSetor(setor.id, t)}</p>
      </div>
      <div className="mt-auto flex gap-2 border-t border-border pt-5 text-xs leading-5 text-text-muted">
        <ShieldCheck
          className="mt-0.5 size-4 shrink-0 text-[var(--atendimento-accent)]"
          aria-hidden
        />
        {t("Suas mensagens ficam separadas das conversas de WhatsApp.")}
      </div>
    </aside>
  );
}

export function PortalDeAtendimento({
  marca,
  logoUrl,
  accent,
  publicId,
  setoresPermitidos,
}: {
  readonly marca: string;
  readonly logoUrl: string | null;
  readonly accent: string;
  readonly publicId?: string;
  readonly setoresPermitidos?: readonly SetorId[];
}) {
  const t = useT();
  const tagDoIdioma = useTagDeIdioma();
  const [setorAtual, setSetorAtual] = useState<SetorId>(setoresPermitidos?.[0] ?? "suporte");
  const [codigo, setCodigo] = useState("");
  const [nome, setNome] = useState("");
  const [primeiraMensagem, setPrimeiraMensagem] = useState("");
  const [ativo, setAtivo] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");
  const [mensagens, setMensagens] = useState<MensagemWebchat[]>([]);
  const geracaoDaConversa = useRef(0);
  const fimDaConversa = useRef<HTMLDivElement>(null);
  const setores = setoresPermitidos
    ? SETORES.filter((item) => setoresPermitidos.includes(item.id))
    : SETORES;
  const setor = SETORES.find((item) => item.id === setorAtual) ?? SETORES[0];
  const css = {
    "--atendimento-accent": accent,
    "--atendimento-accent-soft": `${accent}16`,
  } as React.CSSProperties;

  const novoAtendimento = () => {
    geracaoDaConversa.current += 1;
    setAtivo(false);
    setMensagens([]);
    setRascunho("");
    setPrimeiraMensagem("");
    setErro(null);
  };
  const painel = (
    <PainelDeSetores
      setores={setores}
      setorAtual={setorAtual}
      onEscolher={setSetorAtual}
      ativo={ativo}
      ocupado={ocupado}
      podeIniciarNovo={Boolean(publicId)}
      onNovo={novoAtendimento}
      t={t}
    />
  );

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const response = await fetch("/api/public/webchat/session", {
          credentials: "same-origin",
          headers: publicId ? { "x-webchat-public-id": publicId } : {},
        });
        if (response.status === 401) return;
        const payload = (await response.json()) as {
          data?: { sector?: SetorId };
          error?: { message?: string };
        };
        if (!mounted) return;
        if (!response.ok || !payload.data?.sector) {
          setErro(payload.error?.message ?? t("Não foi possível verificar sua sessão."));
          return;
        }
        setSetorAtual(payload.data.sector);
        setAtivo(true);
      } catch {
        if (mounted) setErro(t("Não foi possível verificar sua sessão."));
      }
    })();
    return () => {
      mounted = false;
    };
  }, [t, publicId]);

  const carregarMensagens = useCallback(async () => {
    const geracao = geracaoDaConversa.current;
    try {
      const response = await fetch("/api/public/webchat/messages", {
        credentials: "same-origin",
        headers: publicId ? { "x-webchat-public-id": publicId } : {},
      });
      const payload = (await response.json()) as {
        data?: MensagemWebchat[];
        error?: { message?: string };
      };
      if (geracao !== geracaoDaConversa.current) return;
      if (response.status === 401) {
        setAtivo(false);
        setMensagens([]);
      }
      if (!response.ok || !payload.data)
        throw new Error(payload.error?.message ?? t("Não foi possível carregar as mensagens."));
      setMensagens(payload.data);
      setErro(null);
    } catch {
      if (geracao !== geracaoDaConversa.current) return;
      setErro(t("Não foi possível carregar as mensagens."));
    }
  }, [t, publicId]);

  useEffect(() => {
    if (!ativo) return;
    const initial = window.setTimeout(() => void carregarMensagens(), 0);
    const interval = window.setInterval(() => void carregarMensagens(), 7_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [ativo, carregarMensagens]);

  useEffect(() => {
    if (ativo) fimDaConversa.current?.scrollIntoView?.({ block: "end" });
  }, [ativo, mensagens]);

  const ativar = async () => {
    setOcupado(true);
    setErro(null);
    try {
      const response = await fetch("/api/public/webchat/consume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: codigo.trim() }),
      });
      const payload = (await response.json()) as {
        data?: { sector?: SetorId };
        error?: { message?: string };
      };
      if (!response.ok || !payload.data?.sector)
        throw new Error(payload.error?.message ?? t("Não foi possível validar o código."));
      setSetorAtual(payload.data.sector);
      setCodigo("");
      setAtivo(true);
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : t("Não foi possível validar o código."));
    } finally {
      setOcupado(false);
    }
  };

  const iniciar = async () => {
    if (!publicId) return;
    setOcupado(true);
    setErro(null);
    const geracao = geracaoDaConversa.current;
    try {
      const response = await fetch("/api/public/webchat/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          public_id: publicId,
          name: nome.trim(),
          sector: setorAtual,
          body: primeiraMensagem.trim(),
          idempotency_key: randomId(),
        }),
      });
      const payload = (await response.json()) as {
        data?: { sector: SetorId; message: MensagemWebchat };
        error?: { message?: string };
      };
      if (!response.ok || !payload.data?.message)
        throw new Error(payload.error?.message ?? t("Não foi possível iniciar o atendimento."));
      if (geracao !== geracaoDaConversa.current) return;
      setSetorAtual(payload.data.sector);
      setMensagens([payload.data.message]);
      setPrimeiraMensagem("");
      setAtivo(true);
    } catch (cause) {
      setErro(
        cause instanceof Error ? cause.message : t("Não foi possível iniciar o atendimento."),
      );
    } finally {
      setOcupado(false);
    }
  };

  const enviar = async () => {
    const body = rascunho.trim();
    if (!body) return;
    const geracao = geracaoDaConversa.current;
    const csrf = document.cookie
      .split("; ")
      .find((item) => item.startsWith("webchat_csrf="))
      ?.split("=")[1];
    if (!csrf) {
      setErro(
        publicId
          ? t("Sua sessão expirou. Inicie um novo atendimento.")
          : t("Sua sessão expirou. Valide o código novamente."),
      );
      return;
    }
    setOcupado(true);
    setErro(null);
    try {
      const response = await fetch("/api/public/webchat/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webchat-csrf": decodeURIComponent(csrf),
          ...(publicId ? { "x-webchat-public-id": publicId } : {}),
        },
        body: JSON.stringify({ body, idempotency_key: randomId() }),
      });
      const payload = (await response.json()) as {
        data?: MensagemWebchat;
        error?: { message?: string };
      };
      if (geracao !== geracaoDaConversa.current) return;
      if (response.status === 401) {
        setAtivo(false);
        setMensagens([]);
      }
      if (!response.ok || !payload.data)
        throw new Error(payload.error?.message ?? t("Não foi possível enviar a mensagem."));
      setMensagens((anteriores) => [...anteriores, payload.data as MensagemWebchat]);
      setRascunho("");
    } catch (cause) {
      if (geracao !== geracaoDaConversa.current) return;
      setErro(cause instanceof Error ? cause.message : t("Não foi possível enviar a mensagem."));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <main style={css} className="min-h-screen bg-bg text-text">
      <section className="mx-auto flex min-h-screen max-w-[1600px] flex-col overflow-hidden bg-surface">
        <header className="flex min-h-20 items-center justify-between gap-4 border-b border-border px-5 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            {logoUrl ? (
              // A URL vem da marca resolvida no servidor; next/image exigiria allowlist em build.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={marca}
                className="h-11 w-28 object-contain object-left sm:w-36"
              />
            ) : (
              <span
                className="truncate text-base font-bold tracking-tight"
                style={{ color: accent }}
              >
                {marca}
              </span>
            )}
            <span className="hidden h-5 w-px bg-border sm:block" aria-hidden />
            <span className="hidden text-sm text-text-muted sm:block">
              {t("Atendimento online")}
            </span>
          </div>

          <div className="flex items-center gap-2 lg:hidden">
            <Sheet>
              <SheetTrigger asChild>
                <Button size="icon" variant="ghost" aria-label={t("Escolher assunto")}>
                  <Menu aria-hidden />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[min(88vw,23rem)] p-5">
                <SheetHeader className="pr-8 text-left">
                  <SheetTitle>{t("Escolha o assunto")}</SheetTitle>
                  <SheetDescription>
                    {ativo
                      ? t("Para mudar de assunto, inicie um novo atendimento.")
                      : t("O setor é escolhido antes de uma conversa ser criada.")}
                  </SheetDescription>
                </SheetHeader>
                <div className="mt-6">{painel}</div>
              </SheetContent>
            </Sheet>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 lg:h-[calc(100dvh-5rem)] lg:grid-cols-[minmax(16rem,0.95fr)_minmax(0,3fr)_minmax(17rem,0.95fr)]">
          <aside className="hidden border-r border-border bg-surface px-6 py-8 lg:block">
            {painel}
          </aside>

          <section
            aria-labelledby="titulo-conversa"
            className="flex min-h-[calc(100dvh-5rem)] min-w-0 flex-col bg-surface-elevated lg:h-[calc(100dvh-5rem)] lg:min-h-0"
          >
            <div className="flex items-center gap-4 border-b border-border px-5 py-5 sm:px-8">
              <span className="grid size-11 place-items-center rounded-full bg-[var(--atendimento-accent-soft)] text-[var(--atendimento-accent)]">
                <setor.Icone size={20} aria-hidden />
              </span>
              <div>
                <h1 id="titulo-conversa" className="text-base font-semibold text-text">
                  {tituloDoSetor(setor.id, t)}
                </h1>
                <p className="mt-0.5 text-sm text-text-muted">
                  {ativo ? t("Atendimento em andamento") : descricaoDoSetor(setor.id, t)}
                </p>
              </div>
            </div>

            {ativo ? (
              <div
                className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-7 sm:px-8"
                role="log"
                aria-label={t("Mensagens do atendimento")}
                aria-live="polite"
              >
                {mensagens.length === 0 ? (
                  <p className="my-auto text-center text-sm text-text-muted">
                    {t("Aguardando mensagens deste atendimento.")}
                  </p>
                ) : (
                  mensagens.map((item) => (
                    <div
                      key={item.id}
                      className={cn(
                        "flex max-w-[85%] flex-col gap-1.5 sm:max-w-[72%]",
                        item.direction === "visitor"
                          ? "items-end self-end"
                          : "items-start self-start",
                      )}
                    >
                      <span className="text-xs font-medium text-text-muted">
                        {item.direction === "visitor" ? t("Você") : t("Equipe")} ·{" "}
                        {new Date(item.created_at).toLocaleTimeString(tagDoIdioma, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <p
                        className={cn(
                          "rounded-2xl px-4 py-3 text-sm leading-6 whitespace-pre-wrap text-text shadow-sm",
                          item.direction === "visitor"
                            ? "rounded-br-md border border-border bg-surface"
                            : "rounded-bl-md border border-[var(--atendimento-accent)] bg-[var(--atendimento-accent-soft)]",
                        )}
                      >
                        {item.body}
                      </p>
                    </div>
                  ))
                )}
                <div ref={fimDaConversa} aria-hidden />
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center px-5 py-10 sm:px-8">
                <div className="w-full max-w-lg">
                  <h2 className="text-2xl font-semibold tracking-tight text-text">
                    {t("Vamos iniciar seu atendimento")}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-text-muted">
                    {descricaoDoSetor(setor.id, t)}
                  </p>
                  {publicId ? (
                    <div className="mt-7 space-y-4 text-left">
                      <label
                        htmlFor="nome-atendimento"
                        className="block text-sm font-medium text-text"
                      >
                        {t("Seu nome")}
                      </label>
                      <input
                        id="nome-atendimento"
                        value={nome}
                        onChange={(event) => setNome(event.target.value)}
                        autoComplete="name"
                        maxLength={80}
                        className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--atendimento-accent)]"
                      />
                      <label
                        htmlFor="primeira-mensagem"
                        className="block text-sm font-medium text-text"
                      >
                        {t("Como podemos ajudar?")}
                      </label>
                      <textarea
                        id="primeira-mensagem"
                        value={primeiraMensagem}
                        onChange={(event) => setPrimeiraMensagem(event.target.value)}
                        maxLength={4000}
                        rows={3}
                        className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--atendimento-accent)]"
                      />
                      <Button
                        type="button"
                        onClick={() => void iniciar()}
                        disabled={ocupado || nome.trim().length < 2 || !primeiraMensagem.trim()}
                      >
                        {t("Iniciar atendimento")}
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-7 text-left">
                      <label htmlFor="codigo-atendimento" className="text-sm font-medium text-text">
                        {t("Código de acesso")}
                      </label>
                      <p className="mt-1 text-xs leading-5 text-text-muted">
                        {t(
                          "Digite o código temporário recebido no atendimento. Ele não vai na URL nem fica salvo neste aparelho.",
                        )}
                      </p>
                      <div className="mt-3 flex gap-2">
                        <input
                          id="codigo-atendimento"
                          value={codigo}
                          onChange={(event) => setCodigo(event.target.value)}
                          autoComplete="one-time-code"
                          className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--atendimento-accent)]"
                        />
                        <Button type="button" onClick={ativar} disabled={ocupado || !codigo.trim()}>
                          {t("Validar")}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {erro ? (
              <p
                className="border-t border-border bg-surface px-5 py-3 text-sm text-destructive sm:px-8"
                role="alert"
              >
                {erro}
              </p>
            ) : null}

            {ativo ? (
              <div className="border-t border-border bg-surface p-4 sm:p-5">
                <label htmlFor="mensagem-atendimento" className="sr-only">
                  {t("Mensagem")}
                </label>
                <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface-elevated p-2.5 focus-within:border-[var(--atendimento-accent)]">
                  <textarea
                    id="mensagem-atendimento"
                    disabled={!ativo || ocupado}
                    value={rascunho}
                    onChange={(event) => setRascunho(event.target.value)}
                    rows={1}
                    placeholder={
                      ativo
                        ? t("Escreva sua mensagem")
                        : t("Inicie o atendimento acima para habilitar as mensagens.")
                    }
                    className="min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm text-text outline-hidden placeholder:text-text-subtle disabled:cursor-not-allowed disabled:opacity-100"
                  />
                  <Button
                    size="icon"
                    disabled={!ativo || ocupado || !rascunho.trim()}
                    onClick={enviar}
                    aria-label={t("Enviar mensagem")}
                    aria-describedby="aviso-envio"
                  >
                    <Send aria-hidden />
                  </Button>
                </div>
                <p id="aviso-envio" className="mt-2 text-xs text-text-muted">
                  {t("Mensagens deste atendimento não se misturam ao histórico de WhatsApp.")}
                </p>
              </div>
            ) : null}
          </section>

          <div className="hidden lg:block">
            <PainelDeStatus setor={setor} ativo={ativo} />
          </div>
        </div>
      </section>
    </main>
  );
}
