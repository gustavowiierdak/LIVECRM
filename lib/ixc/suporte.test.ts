import { describe, expect, it, vi } from "vitest";
import { buscarClienteIxc, criarOrdemIxc, type IxcTransportInput } from "./client";
import {
  consultarDiagnosticoIxc,
  consultarPagamentoIxc,
  listarOrdensIxc,
  resolverDestinoOrdemIxc,
} from "./suporte";
import { documentoIxcValido } from "./documento";

const URL = "https://ixc.example";
const resposta = (registros: unknown[]) => JSON.stringify({ registros, total: registros.length });

describe("identificação IXC por CPF/CNPJ", () => {
  it("não escolhe o primeiro de vários cadastros e permite selecionar apenas um do documento", async () => {
    const transporte = vi.fn(async (_input: IxcTransportInput) =>
      resposta([
        { id: "1", cnpj_cpf: "12345678000195", razao: "Matriz" },
        { id: "2", cnpj_cpf: "12.345.678/0001-95", razao: "Unidade" },
      ]),
    );
    await expect(
      buscarClienteIxc(URL, "token", "12.345.678/0001-95", transporte),
    ).rejects.toMatchObject({ name: "IxcClienteAmbiguoError", clientes: expect.any(Array) });
    await expect(
      buscarClienteIxc(URL, "token", "12345678000195", transporte, "2"),
    ).resolves.toMatchObject({ id: "2" });
    await expect(
      buscarClienteIxc(URL, "token", "12345678000195", transporte, "3"),
    ).resolves.toBeNull();
    expect(JSON.parse(transporte.mock.calls[1]![0].body)).toMatchObject({
      query: "12.345.678/0001-95",
    });
  });
  it("não apaga letras para transformar um documento inválido em válido", () => {
    expect(documentoIxcValido("a12345678909")).toBe(false);
    expect(documentoIxcValido("12.345.678/0001-95")).toBe(true);
  });
});

describe("diagnóstico e pagamentos IXC", () => {
  it("projeta só conexão/sinal, preserva datas e nunca expõe senha", async () => {
    const transporte = async ({ url }: IxcTransportInput) =>
      resposta(
        url.pathname.endsWith("radusuarios")
          ? [
              {
                id: "7",
                id_cliente: "1",
                id_contrato: "2",
                online: "S",
                senha: "segredo",
                ultima_atualizacao: "2026-01-01",
              },
            ]
          : [
              {
                id: "8",
                id_contrato: "2",
                sinal_rx: "-21",
                data_sinal: "2026-01-01",
                senha_onu_cliente: "segredo",
              },
            ],
      );
    const r = await consultarDiagnosticoIxc(URL, "token", "1", "2", transporte);
    expect(r.logins[0]).toMatchObject({ conexao: "online", ultima_atualizacao: "2026-01-01" });
    expect(r.incidente_regional).toBe("nao_consultado");
    expect(JSON.stringify(r)).not.toContain("segredo");
  });
  it("recusa conexão de outro cliente mesmo com contrato aparentemente certo", async () => {
    await expect(
      consultarDiagnosticoIxc(URL, "token", "1", "2", async () =>
        resposta([{ id: "7", id_cliente: "9", id_contrato: "2", online: "N" }]),
      ),
    ).rejects.toThrow();
  });
  it("mantém conexão desconhecida e sinal indisponível quando a API não informa", async () => {
    const r = await consultarDiagnosticoIxc(URL, "token", "1", "2", async ({ url }) => {
      if (url.pathname.endsWith("radusuarios"))
        return resposta([{ id: "7", id_cliente: "1", id_contrato: "2", online: "SS" }]);
      throw new Error("sem permissão");
    });
    expect(r.logins[0]?.conexao).toBe("desconhecida");
    expect(r.sinal_disponivel).toBe(false);
  });
  it.each([
    ["R", "0.00", "N", true],
    ["P", "10.00", "N", false],
    ["A", "0.00", "N", false],
    ["C", "0.00", "N", false],
    ["R", "0.00", "S", false],
    ["R", "10.00", "N", false],
  ])("baixa %s/saldo %s/aguardando %s confirma=%s", async (status, saldo, aguardando, esperado) => {
    const r = await consultarPagamentoIxc(URL, "token", "1", "2", "3", async () =>
      resposta([
        {
          id: "3",
          id_cliente: "1",
          id_contrato: "2",
          status,
          valor_aberto: saldo,
          aguardando_confirmacao_pagamento: aguardando,
        },
      ]),
    );
    expect(r.pagamento_confirmado).toBe(esperado);
  });
  it("ausência de título nunca vira pagamento confirmado", async () => {
    expect(
      await consultarPagamentoIxc(URL, "token", "1", "2", "3", async () => resposta([])),
    ).toEqual({ encontrado: false, pagamento_confirmado: false });
  });
  it("recusa título de outro contrato", async () => {
    await expect(
      consultarPagamentoIxc(URL, "token", "1", "2", "3", async () =>
        resposta([{ id: "3", id_cliente: "1", id_contrato: "9", status: "R" }]),
      ),
    ).rejects.toThrow();
  });
});

describe("ordens de serviço IXC", () => {
  it("consulta agenda real e não inventa conclusão para status desconhecido", async () => {
    const r = await listarOrdensIxc(URL, "token", "1", "2", async () =>
      resposta([
        {
          id: "3",
          id_cliente: "1",
          id_contrato_kit: "2",
          id_assunto: "4",
          setor: "5",
          status: "AG",
          data_agenda: "2026-10-14 08:00:00",
        },
      ]),
    );
    expect(r[0]).toMatchObject({ finalizada: false, data_agenda: "2026-10-14 08:00:00" });
  });
  it("resolve nomes somente quando há correspondência única e exata", async () => {
    const t = async ({ url }: IxcTransportInput) =>
      resposta(
        url.pathname.endsWith("su_oss_assunto")
          ? [{ id: "4", assunto: "Manutenção/Sem Conexão" }]
          : [{ id: "5", setor: "Técnico" }],
      );
    expect(
      await resolverDestinoOrdemIxc(URL, "token", "Manutenção/Sem Conexão", "Técnico", t),
    ).toEqual({ assuntoId: "4", setorId: "5" });
    await expect(resolverDestinoOrdemIxc(URL, "token", "Lentidão", "Técnico", t)).rejects.toThrow();
  });
  it("cria com contrato/filial conferidos sem escrever data de agenda", async () => {
    const t = vi.fn(async (_: IxcTransportInput) => JSON.stringify({ type: "success", id: "10" }));
    await expect(
      criarOrdemIxc(
        URL,
        "token",
        {
          clienteId: "1",
          contratoId: "2",
          filialId: "3",
          assuntoId: "4",
          setorId: "5",
          resumo: "Sem conexão, testes realizados sem sucesso.",
        },
        t,
      ),
    ).resolves.toEqual({ id: "10" });
    const c = t.mock.calls[0]![0];
    expect(c.ixcsoft).toBe("");
    expect(JSON.parse(c.body)).toMatchObject({
      id_cliente: "1",
      id_contrato_kit: "2",
      origem_endereco: "CC",
      status: "A",
    });
    expect(JSON.parse(c.body)).not.toHaveProperty("data_agenda");
  });
});
