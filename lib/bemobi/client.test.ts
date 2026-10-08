import { describe, expect, it, vi } from "vitest";

import {
  BEMOBI_BASE_URL,
  BemobiConnectionError,
  idDePagamentoBemobi,
  listarFaturasBemobi,
  normalizarDocumentoBemobi,
  obterDadosPagamentoBemobi,
  testarConexaoBemobi,
} from "./client";

async function capturarFalha(promise: Promise<unknown>): Promise<BemobiConnectionError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof BemobiConnectionError) return error;
    throw error;
  }
  throw new Error("A consulta deveria falhar.");
}

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
    expect(idDePagamentoBemobi(resultado[0]!)).toBe("200371");
  });

  it("aceita uniqueId nulo e usa o ID do ERP para pagamento", async () => {
    const transportar = vi.fn().mockResolvedValue(JSON.stringify([{
      erpInvoiceId: "629008",
      uniqueId: null,
      dueDate: "2026-10-01T00:00:00",
      amount: 75,
      status: 0,
      erpContractId: "contrato-1",
    }]));
    const faturas = await listarFaturasBemobi("chave", "12345678901", transportar);
    expect(faturas).toHaveLength(1);
    expect(faturas[0]?.uniqueId).toBeNull();
    expect(idDePagamentoBemobi(faturas[0]!)).toBe("629008");
    await expect(testarConexaoBemobi("chave", "12345678901", transportar)).resolves.toEqual({ total: 1 });
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

  it("mostra apenas a estrutura segura quando a resposta não é uma lista", async () => {
    const transportar = vi.fn().mockResolvedValue(JSON.stringify({
      data: [{ erpInvoiceId: "documento-12345678901", amount: 99 }],
      message: "CPF 12345678901 token chave-ultrassecreta",
      "12345678901": "outro dado sigiloso",
    }));
    const falha = await capturarFalha(
      listarFaturasBemobi("chave-ultrassecreta", "12345678901", transportar),
    );
    expect(falha).toMatchObject({ code: "unexpected_response" });
    expect(falha.message).toContain("raiz=objeto");
    expect(falha.message).toContain("data=lista");
    expect(falha.message).toContain("outros_campos=1");
    expect(falha.message).not.toMatch(/12345678901|chave-ultrassecreta|99|outro dado sigiloso/);
  });

  it("aponta tipos inválidos sem mostrar valores da fatura", async () => {
    const transportar = vi.fn().mockResolvedValue(JSON.stringify([{
      erpInvoiceId: "fatura-privada",
      amount: "R$ 123,45",
      status: 1,
      "cliente@example.com": "dado privado",
    }]));
    const falha = await capturarFalha(listarFaturasBemobi("chave", "12345678901", transportar));
    expect(falha).toMatchObject({ code: "unexpected_response" });
    expect(falha.message).toContain("raiz=lista");
    expect(falha.message).toContain("amount=texto");
    expect(falha.message).not.toContain("faltam: uniqueId");
    expect(falha.message).not.toMatch(/fatura-privada|123,45|cliente@example.com|dado privado/);
  });
});
