"use client";

import { createContext, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Slots de apresentação, nunca outra fonte de filtros/contadores.
 * InboxFilters continua dono das abas; TopBar continua dono dos avisos.
 * Fora da casca (testes ou outra tela), os componentes preservam seu lugar original.
 */
const InboxRailContext = createContext<{
  desktop: boolean;
  queues: HTMLDivElement | null;
  tools: HTMLDivElement | null;
  setQueues: (node: HTMLDivElement | null) => void;
  setTools: (node: HTMLDivElement | null) => void;
} | null>(null);

function subscribe(onChange: () => void) {
  const media = window.matchMedia("(min-width: 768px)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
const snapshot = () => window.matchMedia("(min-width: 768px)").matches;
const serverSnapshot = () => false;

export function InboxRailProvider({ children }: { children: ReactNode }) {
  const desktop = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [queues, setQueues] = useState<HTMLDivElement | null>(null);
  const [tools, setTools] = useState<HTMLDivElement | null>(null);
  const value = useMemo(() => ({ desktop, queues, tools, setQueues, setTools }), [desktop, queues, tools]);
  return <InboxRailContext.Provider value={value}>{children}</InboxRailContext.Provider>;
}

export function useInboxRail() {
  return useContext(InboxRailContext);
}

export function InboxQueuePlacement({ children }: { children: ReactNode }) {
  const rail = useInboxRail();
  return rail?.desktop && rail.queues ? createPortal(children, rail.queues) : children;
}
