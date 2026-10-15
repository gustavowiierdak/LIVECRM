"use client";

import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import type { CitacaoWebchat as Citacao } from "@/lib/webchat/types";

/** O mesmo trecho é mostrado no editor, no histórico do operador e no portal. */
export function CitacaoWebchat({ citacao, visitorName }: { citacao: Citacao; visitorName?: string | null }) {
  const t = useT();
  const locale = useTagDeIdioma();
  return (
    <blockquote aria-label={t("Mensagem citada")} className="mb-2 min-w-0 rounded-sm border-l-2 border-current/50 bg-current/5 px-3 py-2 text-xs">
      <div className="mb-1 flex flex-wrap items-center gap-x-2 font-medium">
        <span>{citacao.direction === "visitor" ? visitorName?.trim() || t("Cliente") : citacao.sender_name?.trim() || t("Atendente")}</span>
        <time dateTime={citacao.created_at} className="opacity-75">
          {new Date(citacao.created_at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
        </time>
      </div>
      <p className="line-clamp-3 whitespace-pre-wrap wrap-anywhere">{citacao.body || t("(sem texto)")}</p>
    </blockquote>
  );
}
