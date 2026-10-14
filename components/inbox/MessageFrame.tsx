import type { ReactNode } from "react";
import { Robot, UserCircle } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

/** Presentation only: the caller supplies the recorded author, never today's assignee. */
export function MessageFrame({ outbound, sender, ai = false, searchMatch, children }: {
  outbound: boolean;
  sender: string;
  ai?: boolean;
  searchMatch?: boolean;
  children: ReactNode;
}) {
  const AvatarIcon = ai ? Robot : UserCircle;
  return (
    <div data-search-match={searchMatch || undefined} data-direction={outbound ? "outbound" : "inbound"}
      className={cn("crm-message-row group flex w-full min-w-0 items-start gap-2 px-4 py-1.5", outbound && "flex-row-reverse")}>
      <span aria-hidden className="crm-message-avatar mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <AvatarIcon size={18} weight="fill" />
      </span>
      <div className={cn("crm-message-content flex min-w-0 max-w-[80%] flex-col", outbound ? "items-end" : "items-start")}>
        <div className="crm-message-sender mb-1 max-w-full wrap-anywhere text-xs font-medium text-muted-foreground">{sender}</div>
        {children}
      </div>
    </div>
  );
}
