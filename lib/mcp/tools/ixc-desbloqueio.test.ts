import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { audit } from "@/lib/audit";
import { buscarClienteIxc, desbloquearConfiancaIxc, listarContratosIxc } from "@/lib/ixc/client";
import { carregarIntegracaoIxc } from "@/lib/ixc/integration";

import { confirmarDocumentoDoTurno } from "./documento-confirmado";
import { autorizacaoInequivocaParaDesbloqueio, crmRequestIxcTrustUnlock } from "./ixc";

import type { McpContext } from "../types";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/ixc/client", () => ({
  buscarClienteIxc: vi.fn(),
  listarContratosIxc: vi.fn(),
  desbloquearConfiancaIxc: vi.fn(),
  IxcConnectionError: class extends Error {},
}));
vi.mock("@/lib/ixc/integration", () => ({ carregarIntegracaoIxc: vi.fn() }));
vi.mock("./documento-confirmado", () => ({ confirmarDocumentoDoTurno: vi.fn() }));

const ORG = "11111111-1111-4111-8111-111111111111";
const CONVERSA = "22222222-2222-4222-8222-222222222222";
const CONTATO = "33333333-3333-4333-8333-333333333333";
const CPF = "12345678909";

function cadeiaRetorno<T>(resultado: T) {
  const cadeia: Record<string, unknown> = {};
  for (const metodo of ["select", "eq", "order", "limit", "update"] as const) {
    cadeia[metodo] = vi.fn(() => cadeia);
  }
  cadeia.maybeSingle = vi.fn(async () => resultado);
  cadeia.then = (ok: (valor: T) => unknown, falha?: (erro: unknown) => unknown) =>
    Promise.resolve(resultado).then(ok, falha);
  return cadeia;
}

function contexto(input?: { resposta?: string; pergunta?: string; reservaDuplicada?: boolean }) {
  const pergunta = input?.pergunta ?? "Quer que eu faça o desbloqueio de confiança agora?";
  const resposta = input?.resposta ?? "Sim, pode fazer";
  const recibo = {
    desbloqueado: true,
    contract_id: "7",
    mensagem: "já confirmado",
  };
  const requestHash = createHash("sha256")
    .update(JSON.stringify({ conversation_id: CONVERSA, contract_id: "7" }))
    .digest("hex");
  const insertIdempotencia = vi.fn(async () =>
    input?.reservaDuplicada ? { error: { code: "23505" } } : { error: null },
  );
  const updateIdempotencia = vi.fn(() => cadeiaRetorno({ error: null }));
  const from = vi.fn((tabela: string) => {
    if (tabela === "conversations") {
      return cadeiaRetorno({ data: { contact_id: CONTATO }, error: null });
    }
    if (tabela === "messages") {
      return cadeiaRetorno({
        data: [
          {
            direction: "outbound",
            sent_via: "ai",
            body: pergunta,
            media_derived_text: null,
            created_at: "2026-10-09T12:00:00.000Z",
          },
          {
            direction: "inbound",
            sent_via: "external_device",
            body: resposta,
            media_derived_text: null,
            created_at: "2026-10-09T12:01:00.000Z",
          },
        ],
        error: null,
      });
    }
    if (tabela === "idempotency_keys") {
      const cadeia = cadeiaRetorno({
        data: {
          request_hash: `\\x${requestHash}`,
          response_body: recibo,
        },
        error: null,
      });
      cadeia.insert = insertIdempotencia;
      cadeia.update = updateIdempotencia;
      return cadeia;
    }
    if (tabela === "agent_inbox_items") {
      const cadeia = cadeiaRetorno({ data: null, error: null });
      cadeia.insert = vi.fn(async () => ({ error: null }));
      return cadeia;
    }
    throw new Error(`tabela inesperada: ${tabela}`);
  });
  const ctx = {
    organizationId: ORG,
    contatoDoTurno: CONTATO,
    conversationIdDoTurno: CONVERSA,
    sourceJobId: "job-1",
    role: "ai_operator",
    actor: { type: "ai_agent", id: "agent-1", role: "ai_operator" },
    apiTokenId: "token-1",
    requestId: "request-1",
    supabase: { from },
  } as unknown as McpContext;
  return { ctx, insertIdempotencia, updateIdempotencia };
}

const INPUT = {
  conversation_id: CONVERSA,
  document: CPF,
  contract_id: "7",
  confirmation_text: "Sim, pode fazer",
};

describe("desbloqueio de confiança IXC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(confirmarDocumentoDoTurno).mockResolvedValue({ ok: true, document: CPF });
    vi.mocked(carregarIntegracaoIxc).mockResolvedValue({
      ok: true,
      baseUrl: "https://ixc.example",
      token: "token",
    });
    vi.mocked(buscarClienteIxc).mockResolvedValue({ id: "42", razao: "Cliente" });
    vi.mocked(listarContratosIxc).mockResolvedValue([
      {
        id: "7",
        id_cliente: "42",
        status: "A",
        status_internet: "CA",
        contrato_suspenso: "N",
        desbloqueio_confianca: "P",
        desbloqueio_confianca_ativo: "N",
        restricao_auto_desbloqueio: "N",
      },
    ]);
    vi.mocked(desbloquearConfiancaIxc).mockResolvedValue({ ok: true, message: "sucesso" });
  });

  it.each(["sim", "Sim, pode fazer", "pode desbloquear", "quero sim", "autorizo"])(
    "aceita confirmação curta: %s",
    (frase) => expect(autorizacaoInequivocaParaDesbloqueio(frase)).toBe(true),
  );

  it.each(["não", "acho que sim", "sim, mas não faça", "pode esperar", "talvez", ""])(
    "recusa confirmação ambígua: %s",
    (frase) => expect(autorizacaoInequivocaParaDesbloqueio(frase)).toBe(false),
  );

  it("confere contrato, consentimento e executa uma única ação auditada", async () => {
    const { ctx, insertIdempotencia, updateIdempotencia } = contexto();
    await expect(crmRequestIxcTrustUnlock.handler(INPUT, ctx)).resolves.toMatchObject({
      desbloqueado: true,
      contract_id: "7",
    });
    expect(desbloquearConfiancaIxc).toHaveBeenCalledTimes(1);
    expect(desbloquearConfiancaIxc).toHaveBeenCalledWith("https://ixc.example", "token", "7");
    expect(insertIdempotencia).toHaveBeenCalledTimes(1);
    expect(updateIdempotencia).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ixc.trust_unlock_executed",
        resourceId: "7",
      }),
    );
  });

  it("não executa quando a última resposta não é um sim inequívoco", async () => {
    const { ctx } = contexto({ resposta: "acho que sim" });
    await expect(
      crmRequestIxcTrustUnlock.handler({ ...INPUT, confirmation_text: "acho que sim" }, ctx),
    ).resolves.toMatchObject({ erro: "confirmacao_nao_inequivoca" });
    expect(desbloquearConfiancaIxc).not.toHaveBeenCalled();
  });

  it("não executa quando a IA não perguntou pelo desbloqueio de confiança", async () => {
    const { ctx } = contexto({ pergunta: "Quer que eu continue?" });
    await expect(crmRequestIxcTrustUnlock.handler(INPUT, ctx)).resolves.toMatchObject({
      erro: "confirmacao_sem_pergunta",
    });
    expect(desbloquearConfiancaIxc).not.toHaveBeenCalled();
  });

  it("não executa contrato restrito", async () => {
    vi.mocked(listarContratosIxc).mockResolvedValue([
      {
        id: "7",
        id_cliente: "42",
        status: "A",
        status_internet: "CA",
        contrato_suspenso: "N",
        desbloqueio_confianca: "P",
        desbloqueio_confianca_ativo: "N",
        restricao_auto_desbloqueio: "S",
      },
    ]);
    const { ctx } = contexto();
    await expect(crmRequestIxcTrustUnlock.handler(INPUT, ctx)).resolves.toMatchObject({
      erro: "desbloqueio_indisponivel",
      motivo: "restricao_ativa",
    });
    expect(desbloquearConfiancaIxc).not.toHaveBeenCalled();
  });

  it("repetição com a mesma chave devolve o recibo sem desbloquear de novo", async () => {
    const { ctx } = contexto({ reservaDuplicada: true });
    await expect(crmRequestIxcTrustUnlock.handler(INPUT, ctx)).resolves.toMatchObject({
      desbloqueado: true,
      deduplicated: true,
    });
    expect(desbloquearConfiancaIxc).not.toHaveBeenCalled();
  });
});
