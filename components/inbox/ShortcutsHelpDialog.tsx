"use client";
import { useRef } from "react";
import { useT } from "@/hooks/i18n/useT";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const BINDINGS: { keys: string; description: string }[] = [
  { keys: "j", description: "Próxima conversa" },
  { keys: "k", description: "Conversa anterior" },
  { keys: "r", description: "Focar resposta" },
  // O atalho mais usado do inbox não estava aqui — vivia só no placeholder do
  // composer, que some no instante em que você começa a escrever, ou seja,
  // exatamente quando ia precisar dele para quebrar linha.
  { keys: "Enter", description: "Enviar a mensagem" },
  { keys: "Shift + Enter", description: "Quebrar linha sem enviar" },
  { keys: "a", description: "Assumir conversa" },
  { keys: "e", description: "Encerrar atendimento" },
  { keys: "?", description: "Mostrar atalhos" },
];

export function ShortcutsHelpDialog({ open, onOpenChange }: Props) {
  const t = useT();
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="crm-inbox-dialog sm:max-w-md"
        aria-describedby={undefined}
        onOpenAutoFocus={() => {
          // This controlled dialog can open from either the home button or ?.
          returnFocus.current = document.activeElement instanceof HTMLElement
            ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          if (returnFocus.current?.isConnected) {
            event.preventDefault();
            returnFocus.current.focus();
          }
        }}
      >
        <DialogHeader className="crm-dialog-header">
          <DialogTitle>{t("Atalhos de teclado")}</DialogTitle>
        </DialogHeader>
        <ul className="space-y-2 text-sm">
          {BINDINGS.map((b) => (
            <li key={b.keys} className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">{t(b.description)}</span>
              <kbd className="shrink-0 rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-xs">
                {b.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
