import { describe, expect, it } from "vitest";

import {
  montarDadosDoAtendimento,
  temRelatoDoCliente,
  type MensagemDoAtendimento,
} from "./pergunta-sobre-atendimento";

const imagem: MensagemDoAtendimento = {
  direction: "inbound",
  type: "image",
  body: "Imagem enviada",
  media_derived_text: null,
  sent_via: "crm",
  sent_at: "2026-10-16T09:00:00Z",
};

describe("pergunta sobre atendimento", () => {
  it("não toma o nome de um anexo por relato do cliente", () => {
    expect(temRelatoDoCliente([imagem])).toBe(false);
    expect(temRelatoDoCliente([{ ...imagem, media_derived_text: "Luz LOS vermelha" }])).toBe(true);
  });

  it("usa o texto deste atendimento como dado e preserva quem falou", () => {
    const mensagens: MensagemDoAtendimento[] = [
      { ...imagem, type: "text", body: "A internet caiu em todos os aparelhos" },
      { ...imagem, direction: "outbound", body: "Vou verificar", sent_via: "ai" },
    ];
    const dados = montarDadosDoAtendimento(mensagens);
    expect(dados).toContain("[cliente]");
    expect(dados).toContain("A internet caiu em todos os aparelhos");
    expect(dados).toContain("[IA]");
    expect(dados).toContain("registro de terceiros");
    expect(temRelatoDoCliente(mensagens)).toBe(true);
  });
});
