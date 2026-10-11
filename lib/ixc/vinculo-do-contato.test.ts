import { beforeEach, describe, expect, it, vi } from "vitest";

import { audit } from "@/lib/audit";
import { camposCpfParaGravar, hashCpf } from "@/lib/contacts/cpf";

import { lerVinculoIxc, vincularContatoAoIxc } from "./vinculo-do-contato";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/contacts/cpf", () => ({
  camposCpfParaGravar: vi.fn(),
  hashCpf: (cpf: string) => `hash:${cpf.replace(/\D/g, "")}`,
}));

const CPF = "12345678909";
const CLIENTE = {
  id: "17133",
  razao: "CLIENTE DE TESTE LTDA",
  fantasia: "Cliente de teste",
  ativo: "S",
  telefone_celular: null,
  whatsapp: null,
};

function banco(contato: Record<string, unknown>, atualizado = true) {
  const leitura = {
    select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: contato, error: null }),
  };
  leitura.select.mockReturnValue(leitura); leitura.eq.mockReturnValue(leitura);
  const escrita = {
    update: vi.fn(), eq: vi.fn(), select: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({
      data: atualizado ? { id: "contato-1" } : null, error: null,
    }),
  };
  escrita.update.mockReturnValue(escrita); escrita.eq.mockReturnValue(escrita); escrita.select.mockReturnValue(escrita);
  const from = vi.fn(() => {
    // A primeira passagem é leitura; depois vem a escrita.
    return from.mock.calls.length === 1 ? leitura : escrita;
  });
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  return { supabase: { from, rpc } as never, leitura, escrita, rpc };
}

describe("vínculo do contato com o IXC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(camposCpfParaGravar).mockResolvedValue({
      cpf_hash: hashCpf(CPF), cpf_encrypted: new Uint8Array([1, 2, 3]),
    });
  });

  it("lê apenas metadata completa e com origem conhecida", () => {
    expect(lerVinculoIxc({ ixc_customer_id: "17133" })).toBeNull();
    expect(lerVinculoIxc({
      ixc_customer_id: "17133",
      ixc_customer_name: "Escola",
      ixc_linked_at: "2026-10-09T12:00:00.000Z",
      ixc_linked_by: "automatico",
    })).toEqual({
      customer_id: "17133", customer_name: "Escola",
      linked_at: "2026-10-09T12:00:00.000Z", linked_by: "automatico",
    });
  });

  it("preserva a metadata existente, cifra o CPF e registra o vínculo", async () => {
    const db = banco({
      source_metadata: { campaign_id: "campanha-1" },
      updated_at: "2026-10-09T12:00:00.000Z",
      cpf_hash: null,
      is_anonymized: false,
    });
    const resultado = await vincularContatoAoIxc(db.supabase, {
      organizationId: "org-1", contactId: "contato-1", document: CPF,
      cliente: CLIENTE, origem: "automatico", actorAgentId: "agente-1", requestId: "req-1",
    });
    expect(resultado).toMatchObject({ ok: true, alterado: true, vinculo: {
      customer_id: "17133", customer_name: CLIENTE.razao, linked_by: "automatico",
    } });
    expect(db.escrita.update).toHaveBeenCalledWith(expect.objectContaining({
      cpf_hash: hashCpf(CPF),
      source_metadata: expect.objectContaining({ campaign_id: "campanha-1", ixc_customer_id: "17133" }),
    }));
    expect(db.rpc).toHaveBeenCalledWith("emit_event", expect.objectContaining({
      p_event_type: "contact.ixc_linked", p_entity_id: "contato-1",
    }));
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "contact.ixc_linked" }));
  });

  it("mantém o vínculo IXC no contato do webchat quando o CPF já pertence ao cadastro canônico", async () => {
    const contato = {
      source_metadata: {},
      updated_at: "2026-10-09T12:00:00.000Z",
      cpf_hash: null,
      is_anonymized: false,
    };
    const leitura = {
      select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: contato, error: null }),
    };
    leitura.select.mockReturnValue(leitura); leitura.eq.mockReturnValue(leitura);
    const escrita = (resultado: { data: { id: string } | null; error: { code: string } | null }) => {
      const query = { update: vi.fn(), eq: vi.fn(), select: vi.fn(), maybeSingle: vi.fn().mockResolvedValue(resultado) };
      query.update.mockReturnValue(query); query.eq.mockReturnValue(query); query.select.mockReturnValue(query);
      return query;
    };
    const comCpf = escrita({ data: null, error: { code: "23505" } });
    const somenteMetadata = escrita({ data: { id: "contato-1" }, error: null });
    const from = vi.fn()
      .mockReturnValueOnce(leitura)
      .mockReturnValueOnce(comCpf)
      .mockReturnValueOnce(somenteMetadata);
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

    await expect(vincularContatoAoIxc({ from, rpc } as never, {
      organizationId: "org-1", contactId: "contato-1", document: CPF,
      cliente: CLIENTE, origem: "automatico",
    })).resolves.toMatchObject({ ok: true, alterado: true });

    expect(comCpf.update).toHaveBeenCalledWith(expect.objectContaining({ cpf_hash: hashCpf(CPF) }));
    expect(somenteMetadata.update).toHaveBeenCalledWith({
      source_metadata: expect.objectContaining({ ixc_customer_id: CLIENTE.id }),
    });
    expect(rpc).toHaveBeenCalledWith("emit_event", expect.objectContaining({
      p_event_type: "contact.ixc_linked",
    }));
  });

  it("automático não substitui outro cadastro já vinculado", async () => {
    const db = banco({
      source_metadata: {
        ixc_customer_id: "99", ixc_customer_name: "Outro",
        ixc_linked_at: "2026-10-08T12:00:00.000Z", ixc_linked_by: "atendente",
      },
      updated_at: "2026-10-09T12:00:00.000Z", cpf_hash: null, is_anonymized: false,
    });
    await expect(vincularContatoAoIxc(db.supabase, {
      organizationId: "org-1", contactId: "contato-1", document: CPF,
      cliente: CLIENTE, origem: "automatico",
    })).resolves.toEqual({ ok: false, motivo: "vinculo_divergente" });
    expect(db.escrita.update).not.toHaveBeenCalled();
  });

  it("a escolha manual pode corrigir o vínculo anterior", async () => {
    const db = banco({
      source_metadata: {
        ixc_customer_id: "99", ixc_customer_name: "Outro",
        ixc_linked_at: "2026-10-08T12:00:00.000Z", ixc_linked_by: "automatico",
      },
      updated_at: "2026-10-09T12:00:00.000Z", cpf_hash: hashCpf("98765432100"), is_anonymized: false,
    });
    const resultado = await vincularContatoAoIxc(db.supabase, {
      organizationId: "org-1", contactId: "contato-1", document: CPF,
      cliente: CLIENTE, origem: "atendente", permitirSubstituicao: true, actorUserId: "user-1",
    });
    expect(resultado).toMatchObject({ ok: true, alterado: true });
    expect(db.escrita.update).toHaveBeenCalled();
  });

  it("não troca o cadastro mantendo o hash do titular anterior se a cifra falhar", async () => {
    vi.mocked(camposCpfParaGravar).mockResolvedValueOnce({});
    const db = banco({
      source_metadata: {
        ixc_customer_id: "99", ixc_customer_name: "Outro",
        ixc_linked_at: "2026-10-08T12:00:00.000Z", ixc_linked_by: "automatico",
      },
      updated_at: "2026-10-09T12:00:00.000Z", cpf_hash: hashCpf("98765432100"), is_anonymized: false,
    });
    await expect(vincularContatoAoIxc(db.supabase, {
      organizationId: "org-1", contactId: "contato-1", document: CPF,
      cliente: CLIENTE, origem: "atendente", permitirSubstituicao: true, actorUserId: "user-1",
    })).resolves.toEqual({ ok: false, motivo: "falha_ao_salvar" });
    expect(db.escrita.update).not.toHaveBeenCalled();
  });
});
