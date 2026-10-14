"use client";
import { createPortal } from "react-dom";
import { useInboxRail } from "./InboxRail";
import { useT } from "@/hooks/i18n/useT";
import { UserCircle } from "@/lib/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertsBell } from "./AlertsBell";
import { AvisoDePropostaEmDestaque } from "./AvisoDePropostaEmDestaque";
import { MobileSidebar } from "./MobileSidebar";
import { TenantSwitcher } from "./TenantSwitcher";
import { UserMenu } from "./UserMenu";
import { SearchTrigger } from "./SearchTrigger";

export function TopBar() {
  const rail = useInboxRail();
  const t = useT();
  if (rail?.desktop && rail.tools) {
    return createPortal(<div className="flex flex-col items-center gap-1">
      <SearchTrigger compact />
      <AlertsBell />
      <AvisoDePropostaEmDestaque />
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" aria-label={t("Conta e preferências")} title={t("Conta e preferências")}
            className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring">
            <UserCircle size={23} aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent side="right" align="end" className="w-72 space-y-3">
          <p className="text-sm font-semibold">{t("Conta e preferências")}</p>
          <TenantSwitcher />
          <UserMenu />
        </PopoverContent>
      </Popover>
    </div>, rail.tools);
  }
  return (
    <header className="crm-topbar sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-2 border-b bg-background/95 px-3 backdrop-blur md:gap-4 md:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <MobileSidebar />
        <TenantSwitcher />
      </div>
      <div className="flex min-w-0 flex-1 justify-center md:max-w-md">
        <SearchTrigger />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <AlertsBell />
        <AvisoDePropostaEmDestaque />
        <UserMenu />
      </div>
    </header>
  );
}
