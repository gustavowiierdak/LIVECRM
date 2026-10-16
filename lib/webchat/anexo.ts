import type { MensagemWebchat } from "./types";

/** O contrato atual só entrega PDFs HTTPS; texto e URLs inválidas não viram links. */
export function pdfDaMensagem(item: MensagemWebchat): string | null {
  if (item.type !== "document" || item.media_mime !== "application/pdf" || !item.media_url) return null;
  try {
    const url = new URL(item.media_url);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
