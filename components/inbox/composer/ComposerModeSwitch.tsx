"use client";

import { useT } from "@/hooks/i18n/useT";
import { ChatCircle, Lock } from "@/lib/ui/icons";

/** Presentation only: each transport keeps its own draft and submission rules. */
export function ComposerModeSwitch({ mode, onChange }: {
  mode: "reply" | "note";
  onChange: (mode: "reply" | "note") => void;
}) {
  const t = useT();
  return (
    <div className="crm-composer-modes" role="group" aria-label={t("Modo de escrita")}>
      <button type="button" aria-pressed={mode === "reply"} onClick={() => onChange("reply")}>
        <ChatCircle size={15} aria-hidden />{t("Responder")}
      </button>
      <button type="button" aria-pressed={mode === "note"} onClick={() => onChange("note")}>
        <Lock size={15} aria-hidden />{t("Nota interna")}
      </button>
      {mode === "note" ? <span className="crm-composer-private" role="status">{t("Esta nota fica visível apenas para a equipe.")}</span> : null}
    </div>
  );
}
