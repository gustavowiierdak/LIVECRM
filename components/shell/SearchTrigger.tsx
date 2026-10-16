"use client";
import { useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { MagnifyingGlass } from "@/lib/ui/icons";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { CommandPalette } from "@/components/shell/CommandPalette";

export function SearchTrigger({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  // `enableOnFormTags`: o atalho precisa funcionar com o cursor dentro do
  // composer do inbox, que é onde o operador passa o dia.
  useHotkeys("mod+k", () => setOpen(true), { preventDefault: true, enableOnFormTags: true });

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className={compact ? "h-10 w-10 p-0 text-muted-foreground" : "gap-2 text-muted-foreground"}
        aria-label={t("Buscar...")}
        title={compact ? `${t("Buscar...")} (⌘K)` : undefined}
        onClick={() => setOpen(true)}
      >
        <MagnifyingGlass size={14} aria-hidden />
        {!compact && <span className="hidden md:inline">{t("Buscar...")}</span>}
        {!compact && <kbd className="ml-2 hidden md:inline rounded-md border bg-muted px-1.5 py-0.5 text-[10px]">⌘K</kbd>}
      </Button>
      <CommandPalette open={open} onOpenChange={setOpen} />
    </>
  );
}
