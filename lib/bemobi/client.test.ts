import { describe, expect, it, vi } from "vitest";

import {
  BEMOBI_BASE_URL,
  BemobiConnectionError,
  listarFaturasBemobi,
  normalizarDocumentoBemobi,
  obterDadosPagamentoBemobi,
  testarConexaoBemobi,
} from "./client";

describe("cliente Bemobi", () => {
  it("normaliza CPF/CNPJ e recusa documentos fora do tamanho", () => {
    expect(normalizarDocumentoBemobi("123.456.789-01")).toBe("12345678901");
    expect(normalizarDocumentoBemobi("12.345.678/0001-90")).toBe("12345678000190");
    expect(() => normalizarDocumentoBemobi("123")).toThrow(BemobiConnectionError);
  });

  it("consulta faturas no host oficial sem colocar a chave na URL", async () => {
    const transportar = vi.fn().mockResolvedValue(
      JSON.stringify([
        {
          erpInvoiceId: "200371",
          uniqueId: "18e60d1b-53b6-4882-86da-b85bd1f1a127",
          dueDate: "2026-10-01T00:00:00",
          amount: 75,
          status: 0,
        },
      ]),
    );
    const resultado = await listarFaturasBemobi("chave-secreta", "123.456.789-01", transportar);
    expect(resultado).toHaveLength(1);
    const chamada = transportar.mock.calls[0]?.[0];
    expect(chamada.url.origin).toBe(BEMOBI_BASE_URL);
    expect(chamada.url.pathname).toBe("/v2/integrations/omnichannel/invoices");
    expect(chamada.url.searchParams.get("txId")).toBe("12345678901");
    expect(chamada.url.toString()).not.toContain("chave-secreta");
  });

  it("valida dados de pagamento sem devolver resposta arbitrária", async () => {
    const transportar = vi.fn().mockResolvedValue(
      JSON.stringify({ id: "fatura-1", amount: 99.9, pixCode: "pix", invoicePDFURL: null }),
    );
    await expect(obterDadosPagamentoBemobi("chave", "fatura-1", transportar)).resolves.toMatchObject({
      id: "fatura-1",
      amount: 99.9,
      pixCode: "pix",
    });
    await expect(
      obterDadosPagamentoBemobi("chave", "../../segredo", transportar),
    ).rejects.toMatchObject({ code: "invalid_invoice" });
  });

  it("usa a listagem somente leitura como teste de conexão", async () => {
    const transportar = vi.fn().mockResolvedValue("[]");
    await expect(testarConexaoBemobi("chave", "12345678901", transportar)).resolves.toEqual({
      total: 0,
    });
  });
});
