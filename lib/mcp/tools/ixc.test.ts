import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashCpf } from "@/lib/contacts/cpf";
import { buscarClienteIxc, listarContratosIxc } from "@/lib/ixc/client";
import { carregarIntegracaoIxc } from "@/lib/ixc/integration";

import { crmGetIxcCustomer, crmListIxcContracts } from "./ixc";

import type { McpContext } from "../types";

vi.mock("@/lib/ixc/client", () => ({
  buscarClienteIxc: vi.fn(),
  listarContratosIxc: vi.fn(),
}));
vi.mock("@/lib/ixc/integration", () => ({
  carregarIntegracaoIxc: vi.fn(),
}));

const CPF = "12345678909";
const INTEGRACAO = { ok: true as const, baseUrl: "https://ixc.example", token: "secreto" };

function contexto(
  cpfHash: string | null = hashCpf(CPF),
  contatoDoTurno: string | null = "contato-1",
) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: cpfHash ? { cpf_hash: cpfHash } : null });
  const consulta = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle,
  };
  consulta.select.mockReturnValue(consulta);
  consulta.eq.mockReturnValue(consulta);
  const from = vi.fn().mockReturnValue(consulta);
  const ctx = {
    organizationId: "org-1",
    contatoDoTurno: contatoDoTurno ?? undefined,
    supabase: { from },
  } as unknown as McpContext;
  return { ctx, from, consulta };
}

describe("consultas IXC para o agente", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(carregarIntegracaoIxc).mockResolvedValue(INTEGRACAO);
  });

  it("recusa chamada externa sem contato do turno, antes de acessar integração", async () => {
    const { ctx } = contexto(hashCpf(CPF), null);
    await expect(crmGetIxcCustomer.handler({ document: CPF }, ctx)).resolves.toMatchObject({
      erro: "sem_contato_do_turno",
    });
    expect(carregarIntegracaoIxc).not.toHaveBeenCalled();
  });

  it("recusa documento diferente e limita a busca ao contato e organização", async () => {
    const { ctx, from, consulta } = contexto();
    await expect(
      crmGetIxcCustomer.handler({ document: "99999999999" }, ctx),
    ).resolves.toMatchObject({
      erro: "cpf_nao_confere",
    });
    expect(from).toHaveBeenCalledWith("contacts");
    expect(consulta.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(consulta.eq).toHaveBeenCalledWith("id", "contato-1");
    expect(buscarClienteIxc).not.toHaveBeenCalled();
  });

  it("recusa CPF ainda não confirmado", async () => {
    const { ctx } = contexto(null);
    await expect(crmListIxcContracts.handler({ document: CPF }, ctx)).resolves.toMatchObject({
      erro: "cpf_nao_confirmado",
    });
    expect(carregarIntegracaoIxc).not.toHaveBeenCalled();
  });

  it("consulta cadastro sem devolver extras nem CPF ao modelo", async () => {
    const { ctx } = contexto();
    vi.mocked(buscarClienteIxc).mockResolvedValue({
      id: "42",
      razao: "Cliente",
      fantasia: "Cliente",
      ativo: "S",
    });
    const resposta = await crmGetIxcCustomer.handler({ document: CPF }, ctx);
    expect(resposta).toMatchObject({ encontrado: true, cliente: { id: "42", nome: "Cliente" } });
    expect(JSON.stringify(resposta)).not.toContain(CPF);
    expect(carregarIntegracaoIxc).toHaveBeenCalledWith(ctx.supabase, "org-1", "customers");
    expect(crmGetIxcCustomer.redigirParaAuditoria?.({ document: CPF })).toEqual({
      document: "[redigido]",
    });
  });

  it("consulta somente contratos do cliente encontrado", async () => {
    const { ctx } = contexto();
    vi.mocked(buscarClienteIxc).mockResolvedValue({
      id: "42",
      razao: "Cliente",
      fantasia: null,
      ativo: "S",
    });
    vi.mocked(listarContratosIxc).mockResolvedValue([
      {
        id: "7",
        id_cliente: "42",
        contrato: "Plano",
        status: "A",
        status_internet: "A",
        bloqueio_automatico: "N",
        contrato_suspenso: "N",
        campo_privado: "não expor",
      },
    ]);
    const resposta = await crmListIxcContracts.handler({ document: CPF }, ctx);
    expect(resposta).toMatchObject({
      encontrado: true,
      total: 1,
      bloqueio_financeiro: false,
      diagnostico: "sem_bloqueio_financeiro_no_ixc",
      contratos: [
        {
          id: "7",
          status: "A",
          situacao_acesso: "ativo",
          bloqueio_financeiro: false,
        },
      ],
    });
    expect(JSON.stringify(resposta)).not.toContain("campo_privado");
    expect(resposta).toMatchObject({
      aviso: expect.stringContaining("Não mencione ao cliente a ausência de bloqueio financeiro"),
    });
    expect(listarContratosIxc).toHaveBeenCalledWith("https://ixc.example", "secreto", "42");
    expect(carregarIntegracaoIxc).toHaveBeenCalledWith(ctx.supabase, "org-1", "contracts");
  });

  it("traduz CA em bloqueio financeiro explícito para o agente", async () => {
    const { ctx } = contexto();
    vi.mocked(buscarClienteIxc).mockResolvedValue({
      id: "42",
      razao: "Cliente",
      fantasia: null,
      ativo: "S",
    });
    vi.mocked(listarContratosIxc).mockResolvedValue([
      {
        id: "7",
        id_cliente: "42",
        contrato: "Plano",
        status: "A",
        status_internet: "CA",
        bloqueio_automatico: "S",
        contrato_suspenso: "N",
        desbloqueio_confianca: "P",
        desbloqueio_confianca_ativo: "N",
        restricao_auto_desbloqueio: "N",
      },
    ]);

    await expect(crmListIxcContracts.handler({ document: CPF }, ctx)).resolves.toMatchObject({
      encontrado: true,
      bloqueio_financeiro: true,
      contratos_bloqueados_financeiro: 1,
      diagnostico: "bloqueio_financeiro_confirmado",
      contratos: [
        {
          id: "7",
          situacao_acesso: "bloqueado_financeiro",
          bloqueio_financeiro: true,
          desbloqueio_confianca: {
            configuracao: "padrao_da_empresa",
            disponivel_para_solicitar: true,
            motivo: "disponivel",
          },
        },
      ],
      aviso: expect.stringContaining("causa da falta de acesso"),
    });
  });

  it("não consulta o IXC quando a integração está desligada", async () => {
    const { ctx } = contexto();
    vi.mocked(carregarIntegracaoIxc).mockResolvedValue({ ok: false, reason: "disabled" });
    await expect(crmGetIxcCustomer.handler({ document: CPF }, ctx)).resolves.toMatchObject({
      erro: "disabled",
    });
    expect(buscarClienteIxc).not.toHaveBeenCalled();
  });
});
