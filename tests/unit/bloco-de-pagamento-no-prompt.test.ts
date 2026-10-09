import { describe, expect, it } from "vitest";

import { blocosDePagamentoResidentes } from "@/lib/agent-engine/agent/inbound-turn";

const SEND_PAYMENT = "crm_send_bemobi_payment";

describe("bloco de pagamento residente", () => {
  it("obriga o pacote completo sem perguntar formato quando a ferramenta existe", () => {
    const blocos = blocosDePagamentoResidentes(["crm_list_bemobi_invoices", SEND_PAYMENT]);

    expect(blocos).toHaveLength(1);
    expect(blocos[0]).toContain(SEND_PAYMENT);
    expect(blocos[0]).toContain("NÃO pergunte");
    expect(blocos[0]).toContain("linha digitável");
    expect(blocos[0]).toContain("PIX copia e cola");
    expect(blocos[0]).toContain("fatura em PDF");
    expect(blocos[0]).toContain("mensagens separadas");
    expect(blocos[0]).toContain("imediatamente");
    expect(blocos[0]).toContain("prevalece");
  });

  it("não cita a ferramenta para agentes que não a possuem", () => {
    expect(blocosDePagamentoResidentes(["crm_list_bemobi_invoices"])).toEqual([]);
    expect(blocosDePagamentoResidentes([])).toEqual([]);
  });
});
