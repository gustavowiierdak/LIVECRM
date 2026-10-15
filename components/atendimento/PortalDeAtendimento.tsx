"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Bell,
  BellOff,
  BellRing,
  CircleHelp,
  CircleX,
  Download,
  FileText,
  Menu,
  Mic,
  Paperclip,
  Plus,
  Send,
  Square,
  ShieldCheck,
  WalletCards,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { randomId } from "@/lib/random-id";
import { emitNotification } from "@/lib/notifications/emit";
import { assinarPermissao, getPermission, requestPermission } from "@/lib/notifications/permission";
import { pdfDaMensagem } from "@/lib/webchat/anexo";
import { WEBCHAT_MAX_MEDIA_BYTES, tipoDeAnexoWebchat } from "@/lib/webchat/media";
import {
  assinarInstalacao, inscreverPushVisitante, instaladoNaTelaInicial,
  iphoneOuIpad, precisaInstalarNoIphone,
} from "@/lib/webchat/push-client";
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
import { CitacaoWebchat } from "./CitacaoWebchat";

type SetorId = "suporte" | "financeiro" | "cancelamento";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

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
  encerrado,
  ocupado,
  podeIniciarNovo,
  onNovo,
  t,
}: {
  readonly setores: readonly Setor[];
  readonly setorAtual: SetorId;
  readonly onEscolher: (setor: SetorId) => void;
  readonly ativo: boolean;
  readonly encerrado: boolean;
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
          {encerrado
            ? t("Este atendimento foi encerrado. Você pode iniciar um novo atendimento.")
            : ativo
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

function PainelDeStatus({
  setor,
  ativo,
  encerrado,
}: {
  readonly setor: Setor | null;
  readonly ativo: boolean;
  readonly encerrado: boolean;
}) {
  const t = useT();
  return (
    <aside className="flex h-full flex-col border-l border-border bg-surface px-6 py-7">
      <p className="text-base font-semibold tracking-tight text-text">{t("Seu atendimento")}</p>
      <div className="mt-6 rounded-2xl border border-border bg-surface-elevated p-5">
        <div className="flex items-center gap-3 text-sm font-semibold text-text">
          <span
            className={cn(
              "size-2.5 rounded-full",
              encerrado ? "bg-text-subtle" : ativo ? "bg-emerald-400" : "bg-text-subtle",
            )}
            aria-hidden
          />
          {encerrado
            ? t("Atendimento encerrado")
            : ativo
              ? t("Conectado ao atendimento")
              : t("Aguardando identificação")}
        </div>
        <p className="mt-3 text-sm leading-6 text-text-muted">
          {encerrado
            ? t("A equipe encerrou esta conversa. Inicie um novo atendimento se precisar.")
            : ativo
              ? t("Esta conversa acontece somente nesta página de atendimento.")
              : t("Escolha um assunto e envie sua primeira mensagem para começar.")}
        </p>
      </div>
      <div className="mt-6 border-t border-border pt-5">
        <p className="text-xs font-semibold tracking-[0.12em] text-text-subtle uppercase">
          {ativo ? t("Assunto atual") : t("Assunto escolhido")}
        </p>
        <p className="mt-2 text-sm font-medium text-text">
          {setor ? tituloDoSetor(setor.id, t) : t("Escolha o assunto no formulário")}
        </p>
        {setor ? (
          <p className="mt-1 text-xs leading-5 text-text-muted">{descricaoDoSetor(setor.id, t)}</p>
        ) : null}
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
  const [assuntoInicial, setAssuntoInicial] = useState<SetorId | null>(
    setoresPermitidos?.length === 1 ? (setoresPermitidos[0] ?? null) : null,
  );
  const [menuAberto, setMenuAberto] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [nome, setNome] = useState("");
  const [primeiraMensagem, setPrimeiraMensagem] = useState("");
  const [ativo, setAtivo] = useState(false);
  const [encerrado, setEncerrado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");
  const [mensagens, setMensagens] = useState<MensagemWebchat[]>([]);
  const [novasRespostas, setNovasRespostas] = useState(0);
  const novasRespostasRef = useRef(0);
  const permissaoDeAvisos = useSyncExternalStore(assinarPermissao, getPermission, () => "unsupported");
  const [pushAtivo, setPushAtivo] = useState(false);
  const [pushDisponivel, setPushDisponivel] = useState(false);
  const precisaInstalar = useSyncExternalStore(assinarInstalacao, precisaInstalarNoIphone, () => false);
  const [instalacaoDisponivel, setInstalacaoDisponivel] = useState(false);
  const [mostrarPassosInstalacao, setMostrarPassosInstalacao] = useState(false);
  const instalacaoPendente = useRef<InstallPromptEvent | null>(null);
  const respostasConhecidas = useRef(new Set<string>());
  const historicoCarregado = useRef(false);
  const tituloOriginal = useRef<string | null>(null);
  const [anexo, setAnexo] = useState<File | null>(null);
  const [previewAnexo, setPreviewAnexo] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const gravador = useRef<MediaRecorder | null>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const geracaoDaConversa = useRef(0);
  const historicoRef = useRef<HTMLDivElement>(null);
  const acompanharFim = useRef(true);
  const setores = setoresPermitidos
    ? SETORES.filter((item) => setoresPermitidos.includes(item.id))
    : SETORES;
  const setor = SETORES.find((item) => item.id === setorAtual) ?? SETORES[0];
  const setorExibido = publicId && !ativo && !assuntoInicial ? null : setor;
  const css = {
    "--atendimento-accent": accent,
    "--atendimento-accent-soft": `${accent}16`,
  } as React.CSSProperties;

  useEffect(() => () => {
    const current = gravador.current;
    gravador.current = null;
    if (current) {
      current.onstop = null;
      if (current.state !== "inactive") current.stop();
      current.stream.getTracks().forEach((track) => track.stop());
    }
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  useEffect(() => {
    tituloOriginal.current = document.title;
    const restaurarTitulo = () => {
      if (document.visibilityState === "visible" && tituloOriginal.current)
        document.title = tituloOriginal.current;
    };
    document.addEventListener("visibilitychange", restaurarTitulo);
    return () => {
      document.removeEventListener("visibilitychange", restaurarTitulo);
      if (tituloOriginal.current) document.title = tituloOriginal.current;
    };
  }, []);

  useEffect(() => {
    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      instalacaoPendente.current = event as InstallPromptEvent;
      setInstalacaoDisponivel(true);
    };
    const onInstalled = () => {
      instalacaoPendente.current = null;
      setInstalacaoDisponivel(false);
    };
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const adicionarATelaInicial = async () => {
    const prompt = instalacaoPendente.current;
    if (!prompt) {
      setMostrarPassosInstalacao(true);
      return;
    }
    instalacaoPendente.current = null;
    setInstalacaoDisponivel(false);
    await prompt.prompt();
    await prompt.userChoice;
  };

  const limparAvisoDeResposta = () => {
    novasRespostasRef.current = 0;
    setNovasRespostas(0);
    if (tituloOriginal.current) document.title = tituloOriginal.current;
    acompanharFim.current = true;
    const historico = historicoRef.current;
    if (historico) historico.scrollTop = historico.scrollHeight;
  };

  const ativarAvisos = async () => {
    if (iphoneOuIpad() && !instaladoNaTelaInicial()) {
      setErro(t("No iPhone, toque em Compartilhar, Adicionar à Tela de Início e abra o atendimento pelo novo ícone. Depois, toque em Ativar avisos e permita as notificações."));
      return;
    }
    const resultado = await requestPermission().catch(() => "denied" as const);
    if (resultado !== "granted") {
      setErro(t("Notificações bloqueadas. Libere a permissão nas configurações do navegador."));
      return;
    }
    try {
      const status = await inscreverPushVisitante(publicId);
      setPushAtivo(status === "ok");
      setErro(status === "ok" ? null : t("Não foi possível ativar avisos com o navegador fechado. Tente novamente mais tarde."));
    } catch {
      setPushAtivo(false);
      setErro(t("Não foi possível ativar avisos com o navegador fechado. Tente novamente mais tarde."));
    }
  };

  useEffect(() => {
    if (!ativo || encerrado || permissaoDeAvisos !== "granted" || precisaInstalar) return;
    let cancelled = false;
    void inscreverPushVisitante(publicId).then((status) => {
      if (!cancelled) setPushAtivo(status === "ok");
    }).catch(() => {
      if (!cancelled) setPushAtivo(false);
    });
    return () => { cancelled = true; };
  }, [ativo, encerrado, permissaoDeAvisos, precisaInstalar, publicId]);

  useEffect(() => {
    if (!ativo || encerrado) return;
    let cancelled = false;
    const headers: Record<string, string> = {};
    if (publicId) headers["x-webchat-public-id"] = publicId;
    void fetch("/api/public/webchat/push", { credentials: "same-origin", headers })
      .then(async (response) => response.ok ? await response.json() as { data?: { enabled?: boolean } } : null)
      .then((payload) => { if (!cancelled) setPushDisponivel(payload?.data?.enabled === true); })
      .catch(() => { if (!cancelled) setPushDisponivel(false); });
    return () => { cancelled = true; };
  }, [ativo, encerrado, publicId]);

  const limparAnexo = () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    setPreviewAnexo(null);
    setAnexo(null);
    if (arquivoRef.current) arquivoRef.current.value = "";
  };

  const novoAtendimento = () => {
    geracaoDaConversa.current += 1;
    acompanharFim.current = true;
    historicoCarregado.current = false;
    respostasConhecidas.current.clear();
    novasRespostasRef.current = 0;
    setPushAtivo(false);
    setNovasRespostas(0);
    if (tituloOriginal.current) document.title = tituloOriginal.current;
    setAtivo(false);
    setEncerrado(false);
    setMensagens([]);
    setRascunho("");
    limparAnexo();
    const current = gravador.current;
    gravador.current = null;
    if (current) {
      current.onstop = null;
      if (current.state !== "inactive") current.stop();
      current.stream.getTracks().forEach((track) => track.stop());
    }
    setGravando(false);
    setPrimeiraMensagem("");
    setAssuntoInicial(setoresPermitidos?.length === 1 ? (setoresPermitidos[0] ?? null) : null);
    setMenuAberto(false);
    setErro(null);
  };
  const painel = (
    <PainelDeSetores
      setores={setores}
      setorAtual={setorAtual}
      onEscolher={setSetorAtual}
      ativo={ativo}
      encerrado={encerrado}
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
          data?: { sector?: SetorId; active?: boolean };
          error?: { message?: string };
        };
        if (!mounted) return;
        if (!response.ok || !payload.data?.sector) {
          setErro(payload.error?.message ?? t("Não foi possível verificar sua sessão."));
          return;
        }
        setSetorAtual(payload.data.sector);
        setAtivo(true);
        setEncerrado(payload.data.active === false);
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
      const headers: Record<string, string> = {};
      if (publicId) headers["x-webchat-public-id"] = publicId;
      const [sessionResponse, messagesResponse] = await Promise.all([
        fetch("/api/public/webchat/session", { credentials: "same-origin", headers }),
        fetch("/api/public/webchat/messages", { credentials: "same-origin", headers }),
      ]);
      const sessionPayload = (await sessionResponse.json()) as {
        data?: { sector?: SetorId; active?: boolean };
        error?: { message?: string };
      };
      const messagesPayload = (await messagesResponse.json()) as {
        data?: MensagemWebchat[];
        error?: { message?: string };
      };
      if (geracao !== geracaoDaConversa.current) return;
      if (sessionResponse.status === 401 || messagesResponse.status === 401) {
        historicoCarregado.current = false;
        respostasConhecidas.current.clear();
        novasRespostasRef.current = 0;
        setNovasRespostas(0);
        if (tituloOriginal.current) document.title = tituloOriginal.current;
        setAtivo(false);
        setEncerrado(false);
        setMensagens([]);
        return;
      }
      if (!sessionResponse.ok || !sessionPayload.data?.sector)
        throw new Error(
          sessionPayload.error?.message ?? t("Não foi possível verificar sua sessão."),
        );
      if (!messagesResponse.ok || !messagesPayload.data)
        throw new Error(
          messagesPayload.error?.message ?? t("Não foi possível carregar as mensagens."),
        );
      const respostas = messagesPayload.data.filter((item) => item.direction === "operator");
      const novas = historicoCarregado.current
        ? respostas.filter((item) => !respostasConhecidas.current.has(item.id))
        : [];
      for (const resposta of respostas) respostasConhecidas.current.add(resposta.id);
      historicoCarregado.current = true;
      if (novas.length > 0) {
        novasRespostasRef.current += novas.length;
        setNovasRespostas(novasRespostasRef.current);
        if (document.visibilityState === "hidden") {
          document.title = `(${novasRespostasRef.current}) ${tituloOriginal.current ?? document.title}`;
          if (!pushAtivo) emitNotification({
            kind: "message_inbound",
            title: t("Nova resposta no atendimento"),
            body: t("Abra o atendimento para ver a mensagem."),
            tag: `webchat-${publicId ?? "codigo"}`,
            href: window.location.pathname,
            force: true,
          });
        }
      }
      setSetorAtual(sessionPayload.data.sector);
      setAtivo(true);
      setEncerrado(sessionPayload.data.active === false);
      setMensagens(messagesPayload.data);
      setErro(null);
    } catch {
      if (geracao !== geracaoDaConversa.current) return;
      setErro(t("Não foi possível carregar as mensagens."));
    }
  }, [t, publicId, pushAtivo]);

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
    const historico = historicoRef.current;
    if (ativo && historico && acompanharFim.current) historico.scrollTop = historico.scrollHeight;
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
      historicoCarregado.current = false;
      respostasConhecidas.current.clear();
      setAtivo(true);
      setEncerrado(false);
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : t("Não foi possível validar o código."));
    } finally {
      setOcupado(false);
    }
  };

  const iniciar = async () => {
    if (!publicId || !assuntoInicial || ocupado) return;
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
          sector: assuntoInicial,
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
      historicoCarregado.current = true;
      respostasConhecidas.current.clear();
      setSetorAtual(payload.data.sector);
      setMensagens([payload.data.message]);
      setPrimeiraMensagem("");
      setAtivo(true);
      setEncerrado(false);
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
        setEncerrado(false);
        setMensagens([]);
      }
      if (response.status === 409) setEncerrado(true);
      if (!response.ok || !payload.data)
        throw new Error(payload.error?.message ?? t("Não foi possível enviar a mensagem."));
      acompanharFim.current = true;
      setMensagens((anteriores) => [...anteriores, payload.data as MensagemWebchat]);
      setRascunho("");
    } catch (cause) {
      if (geracao !== geracaoDaConversa.current) return;
      setErro(cause instanceof Error ? cause.message : t("Não foi possível enviar a mensagem."));
    } finally {
      setOcupado(false);
    }
  };

  const selecionarAnexo = (file: File | null) => {
    if (!file) return;
    if (file.size === 0 || file.size > WEBCHAT_MAX_MEDIA_BYTES ||
      !/^(image\/(jpeg|png|webp|gif)|audio\/(webm|ogg|mpeg|mp4|x-m4a|wav))(;|$)/i.test(file.type)) {
      setErro(t("Escolha uma imagem ou áudio de até 10 MB."));
      return;
    }
    setErro(null);
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = URL.createObjectURL(file);
    setPreviewAnexo(previewRef.current);
    setAnexo(file);
  };

  const iniciarGravacao = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setErro(t("Este navegador não permite gravar áudio. Você pode anexar um arquivo de áudio."));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ["audio/webm", "audio/mp4", "audio/ogg"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const parts: BlobPart[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) parts.push(event.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (gravador.current !== recorder) return;
        setGravando(false);
        gravador.current = null;
        const type = recorder.mimeType || mimeType || "audio/webm";
        selecionarAnexo(new File(parts, `audio-${Date.now()}.${type.startsWith("audio/mp4") ? "m4a" : "webm"}`, { type }));
      };
      gravador.current = recorder;
      recorder.start();
      setGravando(true);
      window.setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, 60_000);
    } catch {
      setErro(t("Não foi possível acessar o microfone. Verifique a permissão do navegador."));
    }
  };

  const enviarAnexo = async () => {
    if (!anexo || ocupado) return;
    const csrf = document.cookie.split("; ").find((item) => item.startsWith("webchat_csrf="))?.split("=")[1];
    if (!csrf) { setErro(t("Sua sessão expirou. Inicie um novo atendimento.")); return; }
    const geracao = geracaoDaConversa.current;
    setOcupado(true);
    setErro(null);
    try {
      const form = new FormData();
      form.set("file", anexo);
      form.set("idempotency_key", randomId());
      const response = await fetch("/api/public/webchat/media", {
        method: "POST", credentials: "same-origin",
        headers: { "x-webchat-csrf": decodeURIComponent(csrf),
          ...(publicId ? { "x-webchat-public-id": publicId } : {}) },
        body: form,
      });
      const payload = (await response.json()) as { data?: MensagemWebchat; error?: { message?: string } };
      if (geracao !== geracaoDaConversa.current) return;
      if (response.status === 409) setEncerrado(true);
      if (!response.ok || !payload.data)
        throw new Error(payload.error?.message ?? t("Não foi possível enviar o anexo."));
      acompanharFim.current = true;
      setMensagens((current) => [...current, payload.data!]);
      limparAnexo();
    } catch (cause) {
      if (geracao === geracaoDaConversa.current)
        setErro(cause instanceof Error ? cause.message : t("Não foi possível enviar o anexo."));
    } finally { setOcupado(false); }
  };

  return (
    <main data-theme="light" style={css}
      className={cn("bg-bg text-text",
        ativo ? "h-dvh overflow-hidden lg:h-auto lg:min-h-screen lg:overflow-visible" : "min-h-screen")}>
      <section className={cn(
        "mx-auto flex max-w-[1600px] flex-col overflow-hidden bg-surface",
        ativo ? "h-full lg:h-auto lg:min-h-screen" : "min-h-screen",
      )}>
        <header className="flex min-h-20 shrink-0 items-center justify-between gap-4 border-b border-border px-5 sm:px-8">
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
            {ativo || !publicId ? (
              <Sheet open={menuAberto} onOpenChange={setMenuAberto}>
                <SheetTrigger asChild>
                  <Button size="icon" variant="ghost" aria-label={t("Escolher assunto")}>
                    <Menu aria-hidden />
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side="left"
                  data-theme="light"
                  style={css}
                  className="w-[min(88vw,23rem)] p-5 text-text"
                >
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
            ) : null}
          </div>
        </header>

        <div
          className={cn(
            "grid min-h-0 flex-1 lg:h-[calc(100dvh-5rem)]",
            publicId && !ativo
              ? "lg:grid-cols-[minmax(0,3fr)_minmax(17rem,0.95fr)]"
              : "lg:grid-cols-[minmax(16rem,0.95fr)_minmax(0,3fr)_minmax(17rem,0.95fr)]",
          )}
        >
          {ativo || !publicId ? (
            <aside className="hidden border-r border-border bg-surface px-6 py-8 lg:block">
              {painel}
            </aside>
          ) : null}

          <section
            aria-labelledby="titulo-conversa"
            className={cn(
              "flex min-w-0 flex-col bg-surface-elevated lg:h-[calc(100dvh-5rem)] lg:min-h-0",
              ativo ? "min-h-0" : "min-h-[calc(100dvh-5rem)]",
            )}
          >
            <div className="flex shrink-0 items-center gap-4 border-b border-border px-5 py-5 sm:px-8">
              <span className="grid size-11 place-items-center rounded-full bg-[var(--atendimento-accent-soft)] text-[var(--atendimento-accent)]">
                {setorExibido ? (
                  <setorExibido.Icone size={20} aria-hidden />
                ) : (
                  <CircleHelp size={20} aria-hidden />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <h1 id="titulo-conversa" className="text-base font-semibold text-text">
                  {setorExibido ? tituloDoSetor(setorExibido.id, t) : t("Atendimento online")}
                </h1>
                <p className="mt-0.5 text-sm text-text-muted">
                  {encerrado
                    ? t("Atendimento encerrado")
                    : ativo
                      ? t("Atendimento em andamento")
                      : setorExibido
                        ? descricaoDoSetor(setorExibido.id, t)
                        : t("Escolha o assunto para começar.")}
                </p>
              </div>
              {ativo && !encerrado && (precisaInstalar || !pushAtivo) && permissaoDeAvisos !== "denied" ? (
                <Button type="button" size="sm" variant="outline" onClick={() => void ativarAvisos()}
                  aria-label={t("Ativar notificações de novas respostas")}
                  title={t("Receba avisos no celular mesmo com o atendimento fechado.")}
                  className="shrink-0">
                  <Bell aria-hidden />
                  <span className="hidden sm:inline">{t("Ativar avisos")}</span>
                </Button>
              ) : null}
              {ativo && pushAtivo ? (
                <span className="shrink-0 text-[var(--atendimento-accent)]"
                  aria-label={t("Notificações ativadas")}
                  title={t("Você receberá avisos mesmo com o atendimento fechado.")}>
                  <BellRing size={19} aria-hidden />
                </span>
              ) : null}
              {ativo && permissaoDeAvisos === "denied" ? (
                <Button type="button" size="icon" variant="ghost"
                  aria-label={t("Notificações bloqueadas no navegador")}
                  title={t("Libere as notificações nas configurações do navegador.")}
                  onClick={() => setErro(t("Notificações bloqueadas. Libere a permissão nas configurações do navegador."))}
                  className="shrink-0 text-text-muted">
                  <BellOff size={19} aria-hidden />
                </Button>
              ) : null}
            </div>

            {ativo && !encerrado && !pushAtivo && (precisaInstalar || instalacaoDisponivel) ? (
              <div className="shrink-0 border-b border-border bg-[var(--atendimento-accent-soft)] px-5 py-3 sm:px-8">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-text">
                    {pushDisponivel
                      ? t("Receba respostas mesmo depois de fechar o navegador.")
                      : t("Abra o atendimento direto pela Tela de Início do celular.")}
                  </p>
                  <Button type="button" size="sm" variant="outline" onClick={() => void adicionarATelaInicial()}
                    className="gap-2 border-[var(--atendimento-accent)] text-[var(--atendimento-accent)]">
                    <Download size={16} aria-hidden />
                    {t("Adicionar à Tela de Início")}
                  </Button>
                </div>
                {mostrarPassosInstalacao ? (
                  <p className="mt-2 text-xs leading-5 text-text-muted" role="status">
                    {t("No iPhone: toque em Compartilhar no Safari, escolha Adicionar à Tela de Início e abra o atendimento pelo ícone criado. Depois, toque em Ativar avisos e permita as notificações.")}
                  </p>
                ) : null}
              </div>
            ) : null}

            {ativo && novasRespostas > 0 ? (
              <div role="status" aria-live="polite"
                className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--atendimento-accent)] bg-[var(--atendimento-accent-soft)] px-5 py-2 text-sm text-text sm:px-8">
                <span>{novasRespostas === 1
                  ? t("Nova resposta no atendimento")
                  : `${novasRespostas} ${t("novas respostas no atendimento")}`}</span>
                <Button type="button" size="sm" variant="ghost" onClick={limparAvisoDeResposta}>
                  {t("Ver resposta")}
                </Button>
              </div>
            ) : null}

            {ativo ? (
              <div
                ref={historicoRef}
                onScroll={(event) => {
                  const historico = event.currentTarget;
                  acompanharFim.current = historico.scrollHeight - historico.scrollTop - historico.clientHeight < 72;
                }}
                className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-y-contain px-5 py-7 sm:px-8"
                role="log"
                aria-label={t("Mensagens do atendimento")}
                aria-live="polite"
              >
                {mensagens.length === 0 ? (
                  <p className="my-auto text-center text-sm text-text-muted">
                    {t("Aguardando mensagens deste atendimento.")}
                  </p>
                ) : (
                  mensagens.map((item) =>
                    item.direction === "system" ? (
                      <div
                        key={item.id}
                        className="self-center rounded-full border border-border bg-surface px-4 py-2 text-center text-xs font-medium text-text-muted"
                        role="status"
                      >
                        {t(item.body)}
                      </div>
                    ) : (
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
                          {item.direction === "visitor"
                            ? t("Você")
                            : item.sender_kind === "ai"
                              ? `${item.sender_name?.trim() || t("IA")}${item.sender_name?.trim() ? ` · ${t("IA")}` : ""}`
                              : item.sender_name?.trim() || t("Equipe")}{" "}
                          ·{" "}
                          {new Date(item.created_at).toLocaleTimeString(tagDoIdioma, {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        {tipoDeAnexoWebchat(item) === "image" ? (
                          <a href={`/api/public/webchat/media/${item.id}`} target="_blank" rel="noopener noreferrer"
                            className="block w-48 max-w-full overflow-hidden rounded-2xl border border-border bg-surface sm:w-64">
                            {/* URL privada, validada pela sessão web em cada acesso. */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/api/public/webchat/media/${item.id}`} alt={t("Imagem enviada")}
                              loading="lazy" className="max-h-72 w-full object-contain" />
                            <span className="block border-t border-border px-3 py-2 text-xs text-text-muted">
                              {t("Imagem enviada")}
                            </span>
                          </a>
                        ) : tipoDeAnexoWebchat(item) === "audio" ? (
                          <audio controls preload="metadata" src={`/api/public/webchat/media/${item.id}`}
                            aria-label={t("Áudio enviado")} className="max-w-full" />
                        ) : pdfDaMensagem(item) ? (
                          <a
                            href={pdfDaMensagem(item) ?? undefined}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex min-w-64 items-center gap-3 rounded-2xl rounded-bl-md border border-[var(--atendimento-accent)] bg-[var(--atendimento-accent-soft)] px-4 py-3 text-left text-text shadow-sm transition-opacity hover:opacity-85"
                            aria-label={`${item.body} ${t("Baixar PDF")}`}
                          >
                            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--atendimento-accent)] text-white">
                              <FileText size={20} aria-hidden />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm leading-5 font-medium">
                                {item.body}
                              </span>
                              <span className="mt-1 flex items-center gap-1 text-xs text-text-muted">
                                <Download size={13} aria-hidden />
                                {t("Baixar PDF")}
                              </span>
                            </span>
                          </a>
                        ) : (
                          <div
                            className={cn(
                              "rounded-2xl px-4 py-3 text-sm leading-6 whitespace-pre-wrap text-text shadow-sm",
                              item.direction === "visitor"
                                ? "rounded-br-md border border-border bg-surface"
                                : "rounded-bl-md border border-[var(--atendimento-accent)] bg-[var(--atendimento-accent-soft)]",
                            )}
                          >
                            {item.reply_to && <CitacaoWebchat citacao={item.reply_to} visitorName={t("Você")} />}
                            <p>{item.body}</p>
                          </div>
                        )}
                      </div>
                    ),
                  )
                )}
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-start px-5 py-8 sm:px-8 lg:justify-center">
                <div className="w-full max-w-lg">
                  <h2 className="text-2xl font-semibold tracking-tight text-text">
                    {t("Vamos iniciar seu atendimento")}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-text-muted">
                    {setorExibido
                      ? descricaoDoSetor(setorExibido.id, t)
                      : t("Informe seus dados e escolha o assunto para começar.")}
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
                      <fieldset className="space-y-2">
                        <legend className="mb-2 text-sm font-medium text-text">
                          {t("Assunto do atendimento")}
                        </legend>
                        {setores.map(({ id, Icone }) => (
                          <label
                            key={id}
                            className={cn(
                              "flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 transition-colors",
                              "focus-within:ring-2 focus-within:ring-[var(--atendimento-accent)]",
                              assuntoInicial === id
                                ? "border-[var(--atendimento-accent)] bg-[var(--atendimento-accent-soft)]"
                                : "border-border bg-surface hover:border-[var(--atendimento-accent)]",
                            )}
                          >
                            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--atendimento-accent-soft)] text-[var(--atendimento-accent)]">
                              <Icone size={19} aria-hidden />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-semibold text-text">
                                {tituloDoSetor(id, t)}
                              </span>
                              <span className="block text-xs text-text-muted">
                                {descricaoDoSetor(id, t)}
                              </span>
                            </span>
                            <input
                              type="radio"
                              name="assunto-atendimento"
                              value={id}
                              checked={assuntoInicial === id}
                              onChange={() => {
                                setAssuntoInicial(id);
                                setSetorAtual(id);
                              }}
                              className="size-4 shrink-0 accent-[var(--atendimento-accent)]"
                            />
                          </label>
                        ))}
                      </fieldset>
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
                        disabled={
                          ocupado ||
                          !assuntoInicial ||
                          nome.trim().length < 2 ||
                          !primeiraMensagem.trim()
                        }
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

            {ativo && !encerrado ? (
              <div className="shrink-0 border-t border-border bg-surface p-4 sm:p-5">
                {anexo ? (
                  <div className="mb-2 rounded-xl border border-border px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate">{anexo.name}</span>
                      <Button type="button" variant="ghost" size="sm" disabled={ocupado}
                        onClick={limparAnexo}>
                        {t("Remover")}</Button>
                      <Button type="button" size="sm" disabled={ocupado} onClick={() => void enviarAnexo()}>
                        {ocupado ? t("Enviando…") : t("Enviar anexo")}
                      </Button>
                    </div>
                    {previewAnexo && anexo.type.startsWith("audio/") ? (
                      <audio controls preload="metadata" src={previewAnexo}
                        aria-label={t("Ouvir antes de enviar")} className="mt-2 max-w-full" />
                    ) : null}
                  </div>
                ) : null}
                <label htmlFor="mensagem-atendimento" className="sr-only">
                  {t("Mensagem")}
                </label>
                <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface-elevated p-2.5 focus-within:border-[var(--atendimento-accent)]">
                  {publicId ? <>
                  <input ref={arquivoRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,audio/webm,audio/ogg,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav"
                    className="sr-only" aria-label={t("Selecionar imagem ou áudio")}
                    onChange={(event) => selecionarAnexo(event.target.files?.[0] ?? null)} />
                  <Button type="button" size="icon" variant="ghost" disabled={ocupado || gravando}
                    onClick={() => arquivoRef.current?.click()} aria-label={t("Anexar imagem ou áudio")}>
                    <Paperclip aria-hidden />
                  </Button>
                  <Button type="button" size="icon" variant="ghost" disabled={ocupado}
                    onClick={() => gravando ? gravador.current?.stop() : void iniciarGravacao()}
                    aria-label={gravando ? t("Parar gravação") : t("Gravar áudio")}
                    aria-pressed={gravando}>
                    {gravando ? <Square aria-hidden /> : <Mic aria-hidden />}
                  </Button>
                  </> : null}
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
            <PainelDeStatus setor={setorExibido} ativo={ativo} encerrado={encerrado} />
          </div>
        </div>
      </section>
    </main>
  );
}
