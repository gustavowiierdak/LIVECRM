import { describe, expect, it } from "vitest";

import { sessaoTransportaWhatsapp } from "./sessao-transporta-whatsapp";

describe("tipo de sessão para confirmação financeira", () => {
  it("aceita transportes de mensagens WhatsApp e recusa outros canais", () => {
    for (const provider of ["waha", "meta_cloud", "zernio", "datafy"]) {
      expect(sessaoTransportaWhatsapp(provider)).toBe(true);
    }
    for (const provider of ["zernio_social", "wacalls", "webchat", null, "desconhecido"]) {
      expect(sessaoTransportaWhatsapp(provider)).toBe(false);
    }
  });
});
