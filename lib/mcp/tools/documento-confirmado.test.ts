import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashCpf } from "@/lib/contacts/cpf";
import { buscarClienteIxc } from "@/lib/ixc/client";
import { carregarIntegracaoIxc } from "@/lib/ixc/integration";

import { confirmarDocumentoDoTurno } from "./documento-confirmado";

import type { McpContext } from "../types";

vi.mock("@/lib/ixc/client", () => ({ buscarClienteIxc: vi.fn() }));
vi.mock("@/lib/ixc/integration", () => ({ carregarIntegracaoIxc: vi.fn() }));
vi.mock("@/lib/channels/sessao-transporta-whatsapp", () => ({
  sessaoTransportaWhatsapp: (provider: string) => provider === "mensagens",
}));

const CPF = "12345678909";
const IXC = { ok: true as const, baseUrl: "https://ixc.example", token: "secreto" };

function contexto(input: {
  cpfHash?: string | null;
  waIdentity?: string | null;
  source?: string;
  sourceJobId?: string;
  conversationIdDoTurno?: string;
  conversationContactId?: string;
  sessionProvider?: string;
} = {}) {
  const contato = {
    cpf_hash: input.cpfHash ?? null,
    wa_identity: input.waIdentity ?? "phone:+5562999998888",
    source: input.source ?? "whatsapp",
  };
  const consulta = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: contato }),
  };
  consulta.select.mockReturnValue(consulta);
  consulta.eq.mockReturnValue(consulta);
  const conversa = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { contact_id: input.conversationContactId ?? "contato-1", channel_session_id: "sessao-1" },
    }),
  };
  conversa.select.mockReturnValue(conversa);
  conversa.eq.mockReturnValue(conversa);
  const sessao = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { provider: input.sessionProvider ?? "mensagens" } }),
  };
  sessao.select.mockReturnValue(sessao);
  sessao.eq.mockReturnValue(sessao);
  const from = vi.fn((table: string) => {
    if (table === "contacts") return consulta;
    if (table === "conversations") return conversa;
    if (table === "channel_sessions") return sessao;
    throw new Error(`tabela inesperada: ${table}`);
  });
  const ctx = {
    organizationId: "org-1",
    contatoDoTurno: "contato-1",
    sourceJobId: input.sourceJobId === "ausente" ? undefined : "job-1",
    conversationIdDoTurno: input.conversationIdDoTurno === "ausente" ? undefined : "conversa-1",
    supabase: { from },
  } as unknown as McpContext;
  return { ctx, from, consulta, conversa, sessao };
}

describe("confirmação de documento no turno", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(carregarIntegracaoIxc).mockResolvedValue(IXC);
  });

  it("aceita o CPF já vinculado e não acessa o IXC", async () => {
    const { ctx } = contexto({ cpfHash: hashCpf(CPF) });
    await expect(confirmarDocumentoDoTurno(ctx, CPF)).resolves.toEqual({ ok: true, document: CPF });
    expect(carregarIntegracaoIxc).not.toHaveBeenCalled();
  });

  it("recusa CPF divergente sem buscar outro cadastro", async () => {
    const { ctx } = contexto({ cpfHash: hashCpf(CPF) });
    await expect(confirmarDocumentoDoTurno(ctx, "99999999999")).resolves.toMatchObject({
      resposta: { erro: "cpf_nao_confere" },
    });
    expect(buscarClienteIxc).not.toHaveBeenCalled();
  });

  it("confirma sem gravar CPF quando o número recebido coincide com o IXC", async () => {
    const { ctx, consulta, conversa, sessao } = contexto({ source: "import" });
    vi.mocked(buscarClienteIxc).mockResolvedValue({
      id: "42",
      razao: "Cliente",
      fantasia: null,
      ativo: "S",
      telefone_celular: "(62) 99999-8888",
      whatsapp: null,
    });
    await expect(confirmarDocumentoDoTurno(ctx, CPF)).resolves.toEqual({ ok: true, document: CPF });
    expect(carregarIntegracaoIxc).toHaveBeenCalledWith(ctx.supabase, "org-1", "customers");
    expect(buscarClienteIxc).toHaveBeenCalledWith(IXC.baseUrl, IXC.token, CPF);
    expect(consulta.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(consulta.eq).toHaveBeenCalledWith("id", "contato-1");
    expect(conversa.eq).toHaveBeenCalledWith("id", "conversa-1");
    expect(sessao.eq).toHaveBeenCalledWith("id", "sessao-1");
    expect(consulta).not.toHaveProperty("update");
  });

  it("recusa outro telefone sem revelar se o CPF existe no IXC", async () => {
    const { ctx } = contexto();
    vi.mocked(buscarClienteIxc).mockResolvedValue({
      id: "42",
      razao: "Outro",
      fantasia: null,
      ativo: "S",
      telefone_celular: "(62) 98888-7777",
      whatsapp: null,
    });
    const resposta = await confirmarDocumentoDoTurno(ctx, CPF);
    expect(resposta).toMatchObject({ resposta: { erro: "cpf_nao_confirmado" } });
    expect(JSON.stringify(resposta)).not.toContain(CPF);
  });

  it("aceita CPF encontrado no IXC para fatura mesmo com outro telefone", async () => {
    const { ctx } = contexto();
    vi.mocked(buscarClienteIxc).mockResolvedValue({
      id: "42",
      razao: "Titular",
      fantasia: null,
      ativo: "S",
      telefone_celular: "(62) 98888-7777",
      whatsapp: null,
    });
    await expect(confirmarDocumentoDoTurno(ctx, CPF, "fatura")).resolves.toEqual({
      ok: true,
      document: CPF,
    });
  });

  it("não aceita CPF ausente no IXC nem para fatura", async () => {
    const { ctx } = contexto();
    vi.mocked(buscarClienteIxc).mockResolvedValue(null);
    await expect(confirmarDocumentoDoTurno(ctx, CPF, "fatura")).resolves.toMatchObject({
      resposta: { erro: "cpf_nao_confirmado" },
    });
  });

  it("recusa identidade sem telefone de canal, sem turno real ou com IXC desligado", async () => {
    for (const input of [
      { waIdentity: "lid:123" },
      { sourceJobId: "ausente" },
      { conversationIdDoTurno: "ausente" },
      { conversationContactId: "outro-contato" },
      { sessionProvider: "social" },
      { sessionProvider: "voz" },
    ]) {
      const { ctx } = contexto(input);
      await expect(confirmarDocumentoDoTurno(ctx, CPF)).resolves.toMatchObject({
        resposta: { erro: "cpf_nao_confirmado" },
      });
    }
    expect(carregarIntegracaoIxc).not.toHaveBeenCalled();
    const { ctx } = contexto();
    vi.mocked(carregarIntegracaoIxc).mockResolvedValue({ ok: false, reason: "disabled" });
    await expect(confirmarDocumentoDoTurno(ctx, CPF)).resolves.toMatchObject({
      resposta: { erro: "cpf_nao_confirmado" },
    });
    expect(buscarClienteIxc).not.toHaveBeenCalled();
  });
});
