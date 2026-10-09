import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashCpf } from "@/lib/contacts/cpf";
import { buscarClienteIxc } from "@/lib/ixc/client";
import { carregarIntegracaoIxc } from "@/lib/ixc/integration";
import { vincularContatoAoIxc } from "@/lib/ixc/vinculo-do-contato";

import { confirmarDocumentoDoTurno } from "./documento-confirmado";

import type { McpContext } from "../types";

vi.mock("@/lib/ixc/client", () => ({ buscarClienteIxc: vi.fn() }));
vi.mock("@/lib/ixc/integration", () => ({ carregarIntegracaoIxc: vi.fn() }));
vi.mock("@/lib/ixc/vinculo-do-contato", () => ({
  vincularContatoAoIxc: vi.fn(),
  lerVinculoIxc: (metadata: Record<string, unknown> | null | undefined) => {
    if (
      typeof metadata?.ixc_customer_id !== "string" ||
      typeof metadata.ixc_customer_name !== "string" ||
      typeof metadata.ixc_linked_at !== "string" ||
      (metadata.ixc_linked_by !== "automatico" && metadata.ixc_linked_by !== "atendente")
    ) return null;
    return {
      customer_id: metadata.ixc_customer_id,
      customer_name: metadata.ixc_customer_name,
      linked_at: metadata.ixc_linked_at,
      linked_by: metadata.ixc_linked_by,
    };
  },
}));
vi.mock("@/lib/channels/sessao-transporta-whatsapp", () => ({
  sessaoTransportaWhatsapp: (provider: string) => provider === "mensagens",
}));

const CPF = "12345678909";
const IXC = { ok: true as const, baseUrl: "https://ixc.example", token: "secreto" };

function contexto(input: {
  cpfHash?: string | null;
  linked?: boolean;
  sourceJobId?: string;
  conversationIdDoTurno?: string;
  conversationContactId?: string;
  sessionProvider?: string;
} = {}) {
  const contato = {
    cpf_hash: input.cpfHash ?? null,
    source_metadata: input.linked ? {
      ixc_customer_id: "42",
      ixc_customer_name: "Cliente",
      ixc_linked_at: "2026-10-09T12:00:00.000Z",
      ixc_linked_by: "automatico",
    } : {},
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
    actor: { type: "ai_agent", id: "run-1", role: "agent", agent_id: "agente-1" },
    requestId: "req-1",
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
    vi.mocked(vincularContatoAoIxc).mockResolvedValue({
      ok: true,
      alterado: true,
      vinculo: {
        customer_id: "42",
        customer_name: "Cliente",
        linked_at: "2026-10-09T12:00:00.000Z",
        linked_by: "automatico",
      },
    });
  });

  it("aceita o CPF já vinculado ao IXC e não repete a consulta", async () => {
    const { ctx } = contexto({ cpfHash: hashCpf(CPF), linked: true });
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

  it("confirma e vincula o cadastro quando o CPF exato existe no IXC", async () => {
    const { ctx, consulta, conversa, sessao } = contexto();
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
    expect(vincularContatoAoIxc).toHaveBeenCalledWith(ctx.supabase, expect.objectContaining({
      organizationId: "org-1", contactId: "contato-1", document: CPF, origem: "automatico",
    }));
  });

  it("usa o CPF confirmado no IXC sem exigir coincidência de telefone", async () => {
    const { ctx } = contexto();
    vi.mocked(buscarClienteIxc).mockResolvedValue({
      id: "42",
      razao: "Outro",
      fantasia: null,
      ativo: "S",
      telefone_celular: "(62) 98888-7777",
      whatsapp: null,
    });
    await expect(confirmarDocumentoDoTurno(ctx, CPF)).resolves.toEqual({ ok: true, document: CPF });
    expect(vincularContatoAoIxc).toHaveBeenCalledTimes(1);
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

  it("aceita e vincula CPF confirmado no IXC no atendimento web", async () => {
    const { ctx } = contexto({ sessionProvider: "webchat" });
    vi.mocked(buscarClienteIxc).mockResolvedValue({
      id: "42", razao: "Titular", fantasia: null, ativo: "S",
      telefone_celular: null, whatsapp: null,
    });
    await expect(confirmarDocumentoDoTurno(ctx, CPF, "fatura")).resolves.toEqual({
      ok: true, document: CPF,
    });
    await expect(confirmarDocumentoDoTurno(ctx, CPF, "cadastro")).resolves.toEqual({
      ok: true, document: CPF,
    });
  });

  it("não aceita CPF ausente no IXC nem para fatura", async () => {
    const { ctx } = contexto();
    vi.mocked(buscarClienteIxc).mockResolvedValue(null);
    await expect(confirmarDocumentoDoTurno(ctx, CPF, "fatura")).resolves.toMatchObject({
      resposta: { erro: "cpf_nao_confirmado" },
    });
  });

  it("recusa sem turno real, fora dos canais atendidos ou com IXC desligado", async () => {
    for (const input of [
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
