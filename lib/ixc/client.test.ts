import { describe, expect, it, vi } from "vitest";

import { IxcConnectionError, normalizarBaseIxc, testarConexaoIxc } from "./client";

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
    await expect(testarConexaoIxc("https://ixc.example", "6:segredo", transportar)).resolves.toEqual({
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
});
