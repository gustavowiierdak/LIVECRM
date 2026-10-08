/** Só sessões de mensagens WhatsApp provam a origem do número da conversa. */
export function sessaoTransportaWhatsapp(provider: string | null | undefined): boolean {
  return provider === "waha" || provider === "meta_cloud" || provider === "zernio" || provider === "datafy";
}
