"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** One set of controls: desktop inspector, inline on smaller screens. */
export function ConversationActionsPlacement({ target, children }: {
  target?: HTMLElement | null;
  children: ReactNode;
}) {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    if (!target) return;
    const query = window.matchMedia("(min-width: 1280px)");
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [target]);
  return desktop && target ? createPortal(children, target) : children;
}
