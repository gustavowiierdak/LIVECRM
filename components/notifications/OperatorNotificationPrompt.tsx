"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Bell, X } from "@/lib/ui/icons";
import { useT } from "@/hooks/i18n/useT";
import { useNotificationPermission } from "@/hooks/notifications/useNotificationPermission";
import { gravarCanal } from "@/lib/notifications/prefs";

const DISMISSED_KEY = "operator-notification-prompt.dismissed.v1";
const DISMISSED_EVENT = "operator-notification-prompt-dismissed";

function isDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribeDismissed(listener: () => void): () => void {
  window.addEventListener("storage", listener);
  window.addEventListener(DISMISSED_EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(DISMISSED_EVENT, listener);
  };
}

function dismissPrompt(): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // Mesmo sem armazenamento, o aviso pode ser fechado nesta aba.
  }
  window.dispatchEvent(new Event(DISMISSED_EVENT));
}

/** Porta de ativação no atendimento; configurações mantêm o diagnóstico à vista. */
export function OperatorNotificationPrompt({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const { permission, enabled, pushStatus, request } = useNotificationPermission();
  const dismissed = useSyncExternalStore(subscribeDismissed, isDismissed, () => true);
  const [dismissedHere, setDismissedHere] = useState(false);
  const [activatedHere, setActivatedHere] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const ready = permission === "granted" && enabled && pushStatus === "ready";
  if (
    compact &&
    (dismissed ||
      dismissedHere ||
      ready ||
      permission === "unsupported" ||
      (permission === "granted" && enabled && !activatedHere))
  )
    return null;

  const denied = permission === "denied";
  const limited = enabled && (pushStatus === "server_unavailable" || pushStatus === "unsupported");
  const error = failed || (enabled && pushStatus === "error");
  const description = denied
    ? t(
        "O navegador bloqueou os avisos. Libere Notificações nas permissões deste site e volte para ativar.",
      )
    : ready
      ? t(
          "Este navegador está inscrito para receber novas mensagens e atendimentos encaminhados à equipe, inclusive com a aba fechada. O navegador e o sistema precisam permitir avisos em segundo plano.",
        )
      : limited
        ? pushStatus === "server_unavailable"
          ? t(
              "Permissão liberada, mas o servidor ainda não está configurado para avisar com a aba fechada. Por enquanto, mantenha o site aberto. Avise o administrador.",
            )
          : t(
              "Este navegador só poderá avisar com o site aberto. Não foi possível ativar o recebimento em segundo plano.",
            )
        : error
          ? t(
              "Não foi possível concluir a ativação em segundo plano. Confira a conexão e tente novamente.",
            )
          : t("Receba avisos de novas mensagens e atendimentos neste computador.");

  async function activate() {
    setActivatedHere(true);
    setBusy(true);
    setFailed(false);
    try {
      // request chama a permissão imediatamente, ainda dentro deste clique.
      if ((await request()) === "granted") gravarCanal("message", "push", true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label={t("Notificações do computador")}
      className={`shrink-0 border-b border-border bg-background ${compact ? "p-3" : "rounded-lg border p-4"}`}
    >
      <div className="flex items-start gap-2">
        <Bell size={18} aria-hidden className="mt-0.5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {t(ready ? "Notificações ativadas" : "Notificações do computador")}
          </p>
          <p
            role={error ? "alert" : "status"}
            className="mt-1 text-xs leading-relaxed text-muted-foreground"
          >
            {description}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {!denied && permission !== "unsupported" && !ready && !limited ? (
              <Button
                size="sm"
                disabled={busy || pushStatus === "syncing"}
                onClick={() => void activate()}
              >
                {t(
                  busy || pushStatus === "syncing"
                    ? "Ativando…"
                    : error
                      ? "Tentar novamente"
                      : "Ativar notificações",
                )}
              </Button>
            ) : null}
            {compact ? (
              <Link
                className="text-xs underline underline-offset-4"
                href="/app/settings/notifications"
              >
                {t("Configurar avisos")}
              </Link>
            ) : null}
            {permission === "unsupported" ? (
              <p className="text-xs text-muted-foreground">
                {t(
                  "Este navegador não oferece notificações do sistema. Use um navegador compatível.",
                )}
              </p>
            ) : null}
          </div>
        </div>
        {compact ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            aria-label={t("Ocultar aviso de notificações")}
            onClick={() => {
              setDismissedHere(true);
              dismissPrompt();
            }}
          >
            <X size={16} aria-hidden />
          </Button>
        ) : null}
      </div>
    </section>
  );
}
