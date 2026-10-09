"use client";

import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { copyToClipboard } from "@/lib/clipboard";
import type { ConfiguracaoWebchat } from "@/lib/webchat/types";

const SETORES = [
  { id: "suporte", label: "Suporte" },
  { id: "financeiro", label: "Financeiro" },
  { id: "cancelamento", label: "Cancelamento" },
] as const;

type WebchatSettings = ConfiguracaoWebchat & { ai_replies_24h?: boolean };
type ApiResponse = { data?: WebchatSettings; error?: { message?: string } };

const DEFAULT_CONFIG: ConfiguracaoWebchat = {
  enabled: false,
  allowed_sectors: [],
  allowed_origins: [],
  handoff_ttl_seconds: 900,
};

const subscribeSiteOrigin = () => () => undefined;
const getSiteOrigin = () => window.location.origin;
const getServerSiteOrigin = () => "";

export function WebchatSettingsForm() {
  const t = useT();
  const [config, setConfig] = useState<WebchatSettings>(DEFAULT_CONFIG);
  const [originsText, setOriginsText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const siteOrigin = useSyncExternalStore(
    subscribeSiteOrigin,
    getSiteOrigin,
    getServerSiteOrigin,
  );
  const [savedEnabled, setSavedEnabled] = useState(false);
  const [replyWindowChanged, setReplyWindowChanged] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/v1/settings/webchat", {
          credentials: "same-origin",
          signal: controller.signal,
        });
        const payload = (await response.json()) as ApiResponse;
        if (!response.ok || !payload.data)
          throw new Error(payload.error?.message ?? t("Não foi possível ler a configuração."));
        setConfig(payload.data);
        setReplyWindowChanged(false);
        setSavedEnabled(payload.data.enabled);
        setOriginsText(payload.data.allowed_origins.join("\n"));
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : t("Não foi possível ler a configuração."),
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [t]);

  function toggleSector(id: (typeof SETORES)[number]["id"]) {
    setConfig((current) => ({
      ...current,
      allowed_sectors: current.allowed_sectors.includes(id)
        ? current.allowed_sectors.filter((sector) => sector !== id)
        : [...current.allowed_sectors, id],
    }));
  }

  function adicionarOrigemAtual() {
    if (!siteOrigin) return;
    const origins = originsText
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
    setOriginsText([...new Set([...origins, siteOrigin])].join("\n"));
  }

  async function salvar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const next = {
        enabled: config.enabled,
        allowed_sectors: config.allowed_sectors,
        allowed_origins: [
          ...new Set(
            originsText
              .split(/\r?\n/)
              .map((value) => value.trim())
              .filter(Boolean),
          ),
        ],
        handoff_ttl_seconds: config.handoff_ttl_seconds,
        ...(replyWindowChanged ? { ai_replies_24h: config.ai_replies_24h ?? false } : {}),
      };
      const response = await fetch("/api/v1/settings/webchat", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      const payload = (await response.json()) as ApiResponse;
      if (!response.ok || !payload.data)
        throw new Error(payload.error?.message ?? t("Não foi possível salvar a configuração."));
      setConfig({
        ...payload.data,
        ai_replies_24h: replyWindowChanged ? payload.data.ai_replies_24h : config.ai_replies_24h,
      });
      setReplyWindowChanged(false);
      setSavedEnabled(payload.data.enabled);
      setOriginsText(payload.data.allowed_origins.join("\n"));
      toast.success(t("Atendimento web salvo."));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t("Não foi possível salvar a configuração."),
      );
    } finally {
      setSaving(false);
    }
  }

  const disabled = loading || saving;
  const linkPronto = config.enabled && savedEnabled && config.public_id && siteOrigin;
  const origemPermitida = siteOrigin && config.allowed_origins.includes(siteOrigin);
  return (
    <Card className="max-w-3xl space-y-4 p-4">
      <div>
        <h2 className="text-sm font-semibold">{t("Atendimento web separado")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t(
            "Compartilhe o link com seus clientes para que iniciem um atendimento. As mensagens chegam à Inbox sem misturar o histórico do WhatsApp. O canal vem desligado até você configurá-lo.",
          )}
        </p>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">{t("Carregando configuração…")}</p>
      ) : (
        <form onSubmit={(event) => void salvar(event)} className="space-y-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={config.enabled}
              disabled={disabled}
              onChange={(event) =>
                setConfig((current) => ({ ...current, enabled: event.target.checked }))
              }
            />
            {t("Permitir atendimento web nesta empresa")}
          </label>
          <fieldset className="space-y-2" disabled={disabled}>
            <legend className="text-sm font-medium">{t("Setores disponíveis")}</legend>
            <div className="flex flex-wrap gap-4">
              {SETORES.map((sector) => (
                <label key={sector.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={config.allowed_sectors.includes(sector.id)}
                    onChange={() => toggleSector(sector.id)}
                  />
                  {t(sector.label)}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={config.ai_replies_24h ?? false}
                disabled={disabled || !config.enabled}
                onChange={(event) => {
                  setConfig((current) => ({ ...current, ai_replies_24h: event.target.checked }));
                  setReplyWindowChanged(true);
                }}
              />
              {t("A IA responde 24 horas por dia")}
            </label>
            <p className="text-xs text-muted-foreground">
              {t("Vale somente para respostas do atendimento web. Não altera o horário do WhatsApp nem os disparos.")}
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="webchat-origins">{t("Endereços permitidos")}</Label>
            <textarea
              id="webchat-origins"
              value={originsText}
              disabled={disabled}
              rows={2}
              onChange={(event) => setOriginsText(event.target.value)}
              placeholder="https://crm.exemplo.test"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <p className="text-xs text-muted-foreground">
              {t(
                "Uma origem exata por linha, sem caminho nem barra final. Use HTTPS; em uma instalação local, HTTP é aceito para localhost ou IP privado.",
              )}
            </p>
            {siteOrigin && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={adicionarOrigemAtual}
                >
                  {t("Usar o endereço atual")}
                </Button>
                <code className="text-xs text-muted-foreground">{siteOrigin}</code>
              </div>
            )}
          </div>
          {linkPronto && !origemPermitida && (
            <p role="alert" className="text-sm text-destructive">
              {t("Inclua este endereço nos Endereços permitidos para ativar o link:")} {siteOrigin}
            </p>
          )}
          {linkPronto && origemPermitida && (
            <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
              <Label htmlFor="webchat-public-link">{t("Link para clientes")}</Label>
              <Input
                id="webchat-public-link"
                value={`${siteOrigin}/atendimento/${config.public_id}`}
                readOnly
                onFocus={(event) => event.currentTarget.select()}
              />
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => {
                  void copyToClipboard(`${siteOrigin}/atendimento/${config.public_id}`)
                    .then((copied) => {
                      if (copied) toast.success(t("Link copiado."));
                      else toast.error(t("Não foi possível copiar o link."));
                    });
                }}>{t("Copiar link")}</Button>
                <Button type="button" variant="outline" asChild>
                  <a href={`/atendimento/${config.public_id}`} target="_blank" rel="noopener noreferrer">
                    {t("Abrir página")}
                  </a>
                </Button>
              </div>
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={disabled}>
            {t("Salvar atendimento web")}
          </Button>
        </form>
      )}
      {!loading && error && !config.enabled && (
        <p className="text-xs text-muted-foreground">
          {t("O atendimento web continua desligado até a configuração ser salva.")}
        </p>
      )}
    </Card>
  );
}
