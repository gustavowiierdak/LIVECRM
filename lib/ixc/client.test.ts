import { describe, expect, it, vi } from "vitest";

import {
  buscarClienteIxc,
  desbloquearConfiancaIxc,
  IxcConnectionError,
  listarContratosIxc,
  normalizarBaseIxc,
  testarConexaoIxc,
} from "./client";

describe("cliente IXC", () => {
  it("normaliza a origem e recusa caminho, HTTP e credencial embutida", () => {
    expect(normalizarBaseIxc(" https://provedor.example:8443/ ")).toBe(
      "https://provedor.example:8443",
    );
    for (const valor of [
      "http://provedor.example",
      "https://provedor.example/webservice/v1",
      "https://user:pass@provedor.example",
      "https://127.0.0.1",
    ]) {
      expect(() => normalizarBaseIxc(valor), valor).toThrow(IxcConnectionError);
    }
  });

  it("testa o endpoint de clientes com apenas um registro", async () => {
    const transportar = vi.fn().mockResolvedValue('{"page":"1","total":"12","registros":[]}');
    await expect(
      testarConexaoIxc("https://ixc.example", "6:segredo", transportar),
    ).resolves.toEqual({
      total: 12,
    });
    const chamada = transportar.mock.calls[0]?.[0];
    expect(chamada.url.toString()).toBe("https://ixc.example/webservice/v1/cliente");
    expect(JSON.parse(chamada.body)).toMatchObject({ qtype: "cliente.id", rp: "1" });
  });

  it("recusa uma resposta que não é a API do IXC", async () => {
    await expect(
      testarConexaoIxc("https://ixc.example", "6:segredo", async () => "<html>login</html>"),
    ).rejects.toMatchObject({ code: "unexpected_response" });
  });

  it("confere o CPF retornado e projeta só os dados do cliente", async () => {
    const transportar = vi.fn().mockResolvedValue(
      JSON.stringify({
        total: "1",
        registros: [
          {
            id: "42",
            cnpj_cpf: "123.456.789-09",
            razao: "Cliente",
            ativo: "S",
            telefone_celular: "(62) 99999-8888",
            whatsapp: "62999998888",
            segredo: "não expor",
          },
        ],
      }),
    );
    await expect(
      buscarClienteIxc("https://ixc.example", "token", "12345678909", transportar),
    ).resolves.toEqual({
      id: "42",
      razao: "Cliente",
      fantasia: undefined,
      ativo: "S",
      telefone_celular: "(62) 99999-8888",
      whatsapp: "62999998888",
    });
    const chamada = transportar.mock.calls[0]?.[0];
    expect(JSON.parse(chamada.body)).toMatchObject({
      qtype: "cliente.cnpj_cpf",
      query: "12345678909",
      oper: "=",
    });
  });

  it("tenta o CPF com máscara quando o IXC omite registros para total zero", async () => {
    const transportar = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({ page: "1", total: 0 }))
      .mockResolvedValueOnce(
        JSON.stringify({
          page: "1",
          total: "1",
          registros: [{ id: "42", cnpj_cpf: "123.456.789-09" }],
        }),
      );
    await expect(
      buscarClienteIxc("https://ixc.example", "token", "12345678909", transportar),
    ).resolves.toMatchObject({ id: "42" });
    expect(transportar).toHaveBeenCalledTimes(2);
    expect(JSON.parse(transportar.mock.calls[1]?.[0].body)).toMatchObject({
      query: "123.456.789-09",
    });
  });

  it("aceita resultado vazio sem registros, mas recusa lista ausente com total positivo", async () => {
    await expect(
      buscarClienteIxc("https://ixc.example", "token", "12345678909", async () =>
        JSON.stringify({ page: "1", total: "0" }),
      ),
    ).resolves.toBeNull();
    await expect(
      buscarClienteIxc("https://ixc.example", "token", "12345678909", async () =>
        JSON.stringify({ page: "1", total: "1" }),
      ),
    ).rejects.toMatchObject({ code: "unexpected_response" });
  });

  it("não devolve cliente de outro CPF mesmo que o IXC o retorne", async () => {
    const transportar = vi.fn().mockResolvedValue(
      JSON.stringify({
        total: "1",
        registros: [{ id: "42", cnpj_cpf: "99999999999", razao: "Outro" }],
      }),
    );
    await expect(
      buscarClienteIxc("https://ixc.example", "token", "12345678909", transportar),
    ).resolves.toBeNull();
    expect(transportar).toHaveBeenCalledTimes(2);
  });

  it("recusa contrato associado a outro cliente", async () => {
    const transportar = vi.fn().mockResolvedValue(
      JSON.stringify({
        total: "1",
        registros: [{ id: "7", id_cliente: "99", contrato: "Plano" }],
      }),
    );
    await expect(
      listarContratosIxc("https://ixc.example", "token", "42", transportar),
    ).rejects.toMatchObject({ code: "unexpected_response" });
  });

  it("recusa consulta paginada que poderia ocultar contratos", async () => {
    const transportar = vi.fn().mockResolvedValue(JSON.stringify({ total: "101", registros: [] }));
    await expect(
      listarContratosIxc("https://ixc.example", "token", "42", transportar),
    ).rejects.toMatchObject({ code: "unexpected_response" });
  });

  it("executa o recurso de desbloqueio com o id e cabeçalho de ação", async () => {
    const transportar = vi
      .fn()
      .mockResolvedValue(JSON.stringify({ type: "success", message: "Desbloqueado" }));
    await expect(
      desbloquearConfiancaIxc("https://ixc.example", "token", "19789", transportar),
    ).resolves.toEqual({ ok: true, message: "Desbloqueado" });
    const chamada = transportar.mock.calls[0]?.[0];
    expect(chamada.url.toString()).toBe("https://ixc.example/webservice/v1/desbloqueio_confianca");
    expect(chamada.ixcsoft).toBe("");
    expect(JSON.parse(chamada.body)).toEqual({ id: "19789" });
  });

  it("separa recusa de negócio do erro de transporte", async () => {
    await expect(
      desbloquearConfiancaIxc("https://ixc.example", "token", "7", async () =>
        JSON.stringify({ type: "error", message: "Desbloqueio indisponível" }),
      ),
    ).resolves.toEqual({ ok: false, message: "Desbloqueio indisponível" });
  });
});
