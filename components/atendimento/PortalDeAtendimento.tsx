"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CircleHelp,
  CircleX,
  Menu,
  MessagesSquare,
  PanelLeftOpen,
  Send,
  ShieldCheck,
  WalletCards,
} from "lucide-react";

import { Button } from "@/components/ui/button";
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

function painelDeSetores({
  setorAtual,
  onEscolher,
  bloqueado,
  t,
}: {
  readonly setorAtual: SetorId;
  readonly onEscolher: (setor: SetorId) => void;
  readonly bloqueado: boolean;
  readonly t: (texto: string) => string;
}) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-text">{t("Como podemos ajudar?")}</p>
        <p className="mt-1 text-xs leading-5 text-text-muted">
          {t("Escolha o assunto para iniciar o atendimento correto.")}
        </p>
      </div>
      <div className="space-y-2" role="list" aria-label={t("Setores de atendimento")}>
        {SETORES.map(({ id, Icone }) => {
          const selecionado = id === setorAtual;
          return (
            <div key={id} role="listitem">
              <button
                type="button"
                aria-pressed={selecionado}
                disabled={bloqueado}
                onClick={() => onEscolher(id)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden",
                  selecionado
                    ? "border-[var(--atendimento-accent)] bg-[var(--atendimento-accent-soft)]"
                    : "border-border bg-surface hover:border-text-subtle hover:bg-surface-elevated",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg",
                    selecionado
                      ? "bg-[var(--atendimento-accent)] text-white"
                      : "bg-surface-elevated text-text-muted",
                  )}
                >
                  <Icone size={18} aria-hidden />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-text">
                    {tituloDoSetor(id, t)}
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-text-muted">
                    {descricaoDoSetor(id, t)}
                  </span>
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PainelDeStatus({ setor, ativo }: { readonly setor: Setor; readonly ativo: boolean }) {
  const t = useT();
  return (
    <aside className="flex h-full flex-col border-l border-border bg-surface p-5">
      <p className="text-sm font-semibold text-text">{t("Seu atendimento")}</p>
      <div className="mt-5 rounded-xl border border-border bg-surface-elevated p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-text">
          <span className="size-2 rounded-full bg-text-subtle" aria-hidden />
          {ativo ? t("Conectado ao atendimento") : t("Aguardando identificação")}
        </div>
        <p className="mt-2 text-xs leading-5 text-text-muted">
          {ativo
            ? t(
                "Sua sessão foi validada. Esta área mostra somente as mensagens do atendimento web.",
              )
            : t(
                "Para proteger seus dados, a conversa só é criada depois que esta página receber uma sessão segura.",
              )}
        </p>
      </div>
      <div className="mt-6 border-t border-border pt-5">
        <p className="text-xs font-semibold tracking-[0.12em] text-text-subtle uppercase">
          {t("Assunto escolhido")}
        </p>
        <p className="mt-2 text-sm font-medium text-text">{tituloDoSetor(setor.id, t)}</p>
        <p className="mt-1 text-xs leading-5 text-text-muted">{descricaoDoSetor(setor.id, t)}</p>
      </div>
      <div className="mt-auto flex gap-2 border-t border-border pt-5 text-xs leading-5 text-text-muted">
        <ShieldCheck
          className="mt-0.5 size-4 shrink-0 text-[var(--atendimento-accent)]"
          aria-hidden
        />
        {t(
          "Não mostramos atendentes, protocolos nem conversas anteriores antes de validar a sessão.",
        )}
      </div>
    </aside>
  );
}

export function PortalDeAtendimento({
  marca,
  logoUrl,
  accent,
  publicId,
}: {
  readonly marca: string;
  readonly logoUrl: string | null;
  readonly accent: string;
  readonly publicId?: string;
}) {
  const t = useT();
  const [setorAtual, setSetorAtual] = useState<SetorId>("suporte");
  const [codigo, setCodigo] = useState("");
  const [nome, setNome] = useState("");
  const [primeiraMensagem, setPrimeiraMensagem] = useState("");
  const [ativo, setAtivo] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");
  const [mensagens, setMensagens] = useState<MensagemWebchat[]>([]);
  const setor = SETORES.find((item) => item.id === setorAtual) ?? SETORES[0];
  const css = {
    "--atendimento-accent": accent,
    "--atendimento-accent-soft": `${accent}16`,
  } as React.CSSProperties;

  const painel = painelDeSetores({ setorAtual, onEscolher: setSetorAtual, bloqueado: ativo, t });

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
    try {
      const response = await fetch("/api/public/webchat/messages", {
        credentials: "same-origin",
        headers: publicId ? { "x-webchat-public-id": publicId } : {},
      });
      const payload = (await response.json()) as {
        data?: MensagemWebchat[];
        error?: { message?: string };
      };
      if (response.status === 401) {
        setAtivo(false);
        setMensagens([]);
      }
      if (!response.ok || !payload.data)
        throw new Error(payload.error?.message ?? t("Não foi possível carregar as mensagens."));
      setMensagens(payload.data);
    } catch (cause) {
      setErro(
        cause instanceof Error ? cause.message : t("Não foi possível carregar as mensagens."),
      );
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
      setSetorAtual(payload.data.sector);
      setMensagens([payload.data.message]);
      setPrimeiraMensagem("");
      setAtivo(true);
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : t("Não foi possível iniciar o atendimento."));
    } finally {
      setOcupado(false);
    }
  };

  const enviar = async () => {
    const body = rascunho.trim();
    if (!body) return;
    const csrf = document.cookie
      .split("; ")
      .find((item) => item.startsWith("webchat_csrf="))
      ?.split("=")[1];
    if (!csrf) {
      setErro(publicId
        ? t("Sua sessão expirou. Inicie um novo atendimento.")
        : t("Sua sessão expirou. Valide o código novamente."));
      return;
    }
    setOcupado(true);
    setErro(null);
    try {
      const response = await fetch("/api/public/webchat/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-webchat-csrf": decodeURIComponent(csrf),
          ...(publicId ? { "x-webchat-public-id": publicId } : {}) },
        body: JSON.stringify({ body, idempotency_key: randomId() }),
      });
      const payload = (await response.json()) as {
        data?: MensagemWebchat;
        error?: { message?: string };
      };
      if (response.status === 401) {
        setAtivo(false);
        setMensagens([]);
      }
      if (!response.ok || !payload.data)
        throw new Error(payload.error?.message ?? t("Não foi possível enviar a mensagem."));
      setMensagens((anteriores) => [...anteriores, payload.data as MensagemWebchat]);
      setRascunho("");
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : t("Não foi possível enviar a mensagem."));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <main style={css} className="min-h-screen bg-[#f7f5fb] p-0 text-text lg:p-6">
      <section className="mx-auto flex min-h-screen max-w-[1440px] flex-col overflow-hidden bg-surface shadow-xl lg:min-h-[calc(100vh-3rem)] lg:rounded-2xl">
        <header className="flex min-h-16 items-center justify-between gap-4 border-b border-border px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {logoUrl ? (
              // A URL vem da marca resolvida no servidor; next/image exigiria allowlist em build.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={marca}
                className="h-9 w-28 object-contain object-left sm:w-36"
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
                    {t("O setor é escolhido antes de uma conversa ser criada.")}
                  </SheetDescription>
                </SheetHeader>
                <div className="mt-6">{painel}</div>
              </SheetContent>
            </Sheet>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(15rem,1fr)_minmax(0,3fr)_minmax(16rem,1fr)]">
          <aside className="hidden border-r border-border bg-surface p-5 lg:block">{painel}</aside>

          <section
            aria-labelledby="titulo-conversa"
            className="flex min-h-[32rem] flex-col bg-[#fcfbff]"
          >
            <div className="flex items-center gap-3 border-b border-border px-4 py-4 sm:px-6">
              <span className="grid size-10 place-items-center rounded-xl bg-[var(--atendimento-accent-soft)] text-[var(--atendimento-accent)]">
                <setor.Icone size={20} aria-hidden />
              </span>
              <div>
                <h1 id="titulo-conversa" className="text-sm font-semibold text-text">
                  {tituloDoSetor(setor.id, t)}
                </h1>
                <p className="mt-0.5 text-xs text-text-muted">
                  {t("Conversa protegida e direcionada ao setor escolhido")}
                </p>
              </div>
            </div>

            <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
              <span className="grid size-14 place-items-center rounded-2xl bg-[var(--atendimento-accent-soft)] text-[var(--atendimento-accent)]">
                <MessagesSquare size={26} aria-hidden />
              </span>
              <h2 className="mt-5 text-xl font-semibold tracking-tight text-text">
                {t("Vamos iniciar seu atendimento")}
              </h2>
              {ativo ? (
                <div className="mt-5 w-full max-w-md space-y-3 text-left" aria-live="polite">
                  <p className="text-center text-sm leading-6 text-text-muted">
                    {t("Atendimento seguro iniciado. A equipe recebe apenas esta conversa web.")}
                  </p>
                  {mensagens.map((item) => (
                    <p
                      key={item.id}
                      className="rounded-xl bg-[var(--atendimento-accent-soft)] px-3 py-2 text-sm text-text"
                    >
                      {item.body}
                    </p>
                  ))}
                </div>
              ) : publicId ? (
                <div className="mt-5 w-full max-w-md space-y-3 text-left">
                  <label htmlFor="nome-atendimento" className="block text-sm font-medium text-text">
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
                  <label htmlFor="primeira-mensagem" className="block text-sm font-medium text-text">
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
                  <Button type="button" onClick={() => void iniciar()}
                    disabled={ocupado || nome.trim().length < 2 || !primeiraMensagem.trim()}>
                    {t("Iniciar atendimento")}
                  </Button>
                </div>
              ) : (
                <div className="mt-5 w-full max-w-md text-left">
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
              {erro ? (
                <p className="mt-3 text-sm text-destructive" role="alert">
                  {erro}
                </p>
              ) : null}
            </div>

            <div className="border-t border-border bg-surface p-3 sm:p-4">
              <label htmlFor="mensagem-atendimento" className="sr-only">
                {t("Mensagem")}
              </label>
              <div className="flex items-end gap-2 rounded-xl border border-border bg-surface-elevated p-2">
                <textarea
                  id="mensagem-atendimento"
                  disabled={!ativo || ocupado}
                  value={rascunho}
                  onChange={(event) => setRascunho(event.target.value)}
                  rows={2}
                  placeholder={
                    ativo
                      ? t("Escreva sua mensagem")
                      : t("Inicie o atendimento acima para habilitar as mensagens.")
                  }
                  className="min-h-11 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-text outline-hidden placeholder:text-text-subtle disabled:cursor-not-allowed disabled:opacity-100"
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
              <p id="aviso-envio" className="mt-2 flex items-center gap-2 text-xs text-text-muted">
                <PanelLeftOpen size={14} aria-hidden />
                {ativo
                  ? t("Mensagens deste atendimento não se misturam ao histórico de WhatsApp.")
                  : t(
                      "O envio permanece bloqueado até você iniciar o atendimento.",
                    )}
              </p>
            </div>
          </section>

          <div className="hidden lg:block">
            <PainelDeStatus setor={setor} ativo={ativo} />
          </div>
        </div>

        <footer className="border-t border-border px-4 py-3 text-center text-xs text-text-muted sm:px-6">
          {t(
            "Se preferir, você pode voltar ao WhatsApp a qualquer momento. O cancelamento permanece um caminho direto, sem barreiras extras.",
          )}
        </footer>
      </section>
    </main>
  );
}
