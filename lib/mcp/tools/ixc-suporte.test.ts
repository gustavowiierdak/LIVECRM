import { beforeEach, describe, expect, it, vi } from "vitest";
import { audit } from "@/lib/audit";
import { buscarClienteIxc, criarOrdemIxc, listarContratosIxc } from "@/lib/ixc/client";
import { carregarIntegracaoIxc } from "@/lib/ixc/integration";
import {
  consultarDiagnosticoIxc,
  consultarPagamentoIxc,
  listarOrdensIxc,
  resolverDestinoOrdemIxc,
} from "@/lib/ixc/suporte";
import { confirmarDocumentoDoTurno } from "./documento-confirmado";
import {
  crmCreateIxcServiceOrder,
  crmGetIxcDiagnostics,
  crmCheckIxcPayment,
  crmListIxcServiceOrders,
} from "./ixc-suporte";
import type { McpContext } from "../types";

vi.mock("@/lib/ixc/client", () => ({
  buscarClienteIxc: vi.fn(),
  criarOrdemIxc: vi.fn(),
  listarContratosIxc: vi.fn(),
}));
vi.mock("@/lib/ixc/integration", () => ({ carregarIntegracaoIxc: vi.fn() }));
vi.mock("@/lib/ixc/suporte", () => ({
  consultarDiagnosticoIxc: vi.fn(),
  consultarPagamentoIxc: vi.fn(),
  listarOrdensIxc: vi.fn(),
  resolverDestinoOrdemIxc: vi.fn(),
}));
vi.mock("./documento-confirmado", () => ({
  confirmarDocumentoDoTurno: vi.fn(),
  respostaCadastroAmbiguo: () => null,
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/ixc/acompanhamento-os", () => ({ acompanharOrdemIxc: vi.fn(async () => false) }));

const entrada = {
  document: "12345678909",
  contract_id: "2",
  reason: "sem_conexao" as const,
  summary: "Sem conexão em todos os aparelhos, reinício já realizado.",
  confirmation_text: "sim",
};
function contexto(
  options: {
    consent?: string;
    pergunta?: string;
    reservationError?: string;
    receiptError?: boolean;
    contactId?: string;
  } = {},
) {
  const filtros: unknown[][] = [];
  const inserts: { table: string; data: Record<string, unknown> }[] = [];
  const from = vi.fn((table: string) => {
    const q = {
      select: vi.fn(() => q),
      eq: vi.fn((...args: unknown[]) => {
        filtros.push([table, ...args]);
        return q;
      }),
      order: vi.fn(() => q),
      limit: vi.fn(() => q),
      maybeSingle: vi.fn(async () => ({ data: { contact_id: options.contactId ?? "contact-1" } })),
      insert: vi.fn(async (data: Record<string, unknown>) => {
        inserts.push({ table, data });
        return {
          error:
            table === "idempotency_keys" && options.reservationError
              ? { code: options.reservationError }
              : null,
        };
      }),
      update: vi.fn(() => q),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(
          resolve(
            table === "messages"
              ? {
                  data: [
                    { direction: "inbound", body: options.consent ?? "sim" },
                    {
                      direction: "outbound",
                      sent_via: "ai",
                      body: options.pergunta ?? "Posso abrir uma ordem de serviço para uma visita?",
                    },
                  ],
                  error: null,
                }
              : { error: options.receiptError ? { code: "erro" } : null },
          ),
        ),
    };
    return q;
  });
  return {
    ctx: {
      supabase: { from },
      organizationId: "org-1",
      contatoDoTurno: "contact-1",
      conversationIdDoTurno: "conversation-1",
      sourceJobId: "job-1",
      actor: { type: "ai_agent", agent_id: "agent-1" },
    } as unknown as McpContext,
    filtros,
    inserts,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(confirmarDocumentoDoTurno).mockResolvedValue({
    ok: true,
    document: entrada.document,
    customerId: "1",
  });
  vi.mocked(carregarIntegracaoIxc).mockResolvedValue({
    ok: true,
    baseUrl: "https://ixc.example",
    token: "segredo",
    routing: {
      sem_conexao: "Manutenção/Sem Conexão",
      lentidao: "Manutenção/Lentidão",
      setor: "Técnico INST/MANC",
    },
  });
  vi.mocked(buscarClienteIxc).mockResolvedValue({ id: "1" });
  vi.mocked(listarContratosIxc).mockResolvedValue([
    { id: "2", id_cliente: "1", id_filial: "3", status: "A", status_internet: "A" },
  ]);
  vi.mocked(listarOrdensIxc).mockResolvedValue([]);
  vi.mocked(resolverDestinoOrdemIxc).mockResolvedValue({ assuntoId: "4", setorId: "5" });
  vi.mocked(criarOrdemIxc).mockResolvedValue({ id: "6" });
});

describe("escopo das consultas prioritárias", () => {
  it("barra recurso desligado antes de ler o cliente", async () => {
    vi.mocked(carregarIntegracaoIxc).mockResolvedValue({ ok: false, reason: "resource_disabled" });
    expect(await crmGetIxcDiagnostics.handler(entrada, contexto().ctx)).toMatchObject({
      erro: "recurso_ixc_indisponivel",
    });
    expect(buscarClienteIxc).not.toHaveBeenCalled();
  });
  it("não consulta dados de outro contrato", async () => {
    expect(
      await crmGetIxcDiagnostics.handler({ ...entrada, contract_id: "99" }, contexto().ctx),
    ).toMatchObject({ erro: "contrato_fora_do_cliente" });
    expect(consultarDiagnosticoIxc).not.toHaveBeenCalled();
  });
  it("preserva o cadastro confirmado em vez de escolher o primeiro", async () => {
    await crmGetIxcDiagnostics.handler(entrada, contexto().ctx);
    expect(buscarClienteIxc).toHaveBeenCalledWith(
      "https://ixc.example",
      "segredo",
      entrada.document,
      undefined,
      "1",
    );
    expect(consultarDiagnosticoIxc).toHaveBeenCalledWith(
      "https://ixc.example",
      "segredo",
      "1",
      "2",
    );
  });
  it("consulta O.S. no contrato escolhido", async () => {
    expect(await crmListIxcServiceOrders.handler(entrada, contexto().ctx)).toMatchObject({
      ordens: [],
    });
    expect(listarOrdensIxc).toHaveBeenCalledWith("https://ixc.example", "segredo", "1", "2");
  });
  it("pagamento confirmado não encerra queixa técnica", async () => {
    vi.mocked(consultarPagamentoIxc).mockResolvedValue({
      encontrado: false,
      pagamento_confirmado: true,
    });
    const r = await crmCheckIxcPayment.handler({ ...entrada, invoice_id: "7" }, contexto().ctx);
    expect(r).toMatchObject({
      pagamento_confirmado: true,
      proximo_passo: expect.stringContaining("continue o diagnóstico"),
    });
    expect(criarOrdemIxc).not.toHaveBeenCalled();
  });
});

describe("abertura segura de O.S.", () => {
  it("reserva antes do efeito, escolhe destino configurado e confirma ID sem prometer agenda", async () => {
    const { ctx, filtros, inserts } = contexto();
    const r = await crmCreateIxcServiceOrder.handler(entrada, ctx);
    expect(r).toMatchObject({ criada: true, ordem_id: "6", agendada: false });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ixc.service_order_created",
        metadata: expect.objectContaining({ ordem_id: "6" }),
      }),
    );
    // resource_id é UUID no CRM; o ID numérico do IXC pertence aos metadados.
    expect(vi.mocked(audit).mock.calls[0]?.[0].resourceId).toBeUndefined();
    expect(resolverDestinoOrdemIxc).toHaveBeenCalledWith(
      "https://ixc.example",
      "segredo",
      "Manutenção/Sem Conexão",
      "Técnico INST/MANC",
    );
    expect(inserts[0]?.table).toBe("idempotency_keys");
    expect(filtros).toContainEqual(["idempotency_keys", "organization_id", "org-1"]);
    expect(criarOrdemIxc).toHaveBeenCalledWith(
      "https://ixc.example",
      "segredo",
      expect.objectContaining({
        clienteId: "1",
        contratoId: "2",
        filialId: "3",
        assuntoId: "4",
        setorId: "5",
      }),
    );
  });
  it("lentidão usa seu próprio assunto no mesmo setor", async () => {
    await crmCreateIxcServiceOrder.handler({ ...entrada, reason: "lentidao" }, contexto().ctx);
    expect(resolverDestinoOrdemIxc).toHaveBeenCalledWith(
      "https://ixc.example",
      "segredo",
      "Manutenção/Lentidão",
      "Técnico INST/MANC",
    );
  });
  it.each(["não", "sim, mas não quero visita", "talvez"])(
    "recusa consentimento %s",
    async (consent) => {
      expect(
        await crmCreateIxcServiceOrder.handler(
          { ...entrada, confirmation_text: consent },
          contexto({ consent }).ctx,
        ),
      ).toMatchObject({ erro: "confirmacao_os_ausente" });
      expect(criarOrdemIxc).not.toHaveBeenCalled();
    },
  );
  it("não usa um sim a outra pergunta", async () => {
    expect(
      await crmCreateIxcServiceOrder.handler(
        entrada,
        contexto({ pergunta: "Você está em casa?" }).ctx,
      ),
    ).toMatchObject({ erro: "confirmacao_os_ausente" });
    expect(criarOrdemIxc).not.toHaveBeenCalled();
  });
  it("não cruza conversas nem aceita outro contato", async () => {
    expect(
      await crmCreateIxcServiceOrder.handler(entrada, contexto({ contactId: "outro" }).ctx),
    ).toMatchObject({ erro: "conversa_fora_do_turno" });
    expect(criarOrdemIxc).not.toHaveBeenCalled();
  });
  it("não cria se houver O.S. não finalizada", async () => {
    vi.mocked(listarOrdensIxc).mockResolvedValue([
      {
        id: "7",
        id_cliente: "1",
        id_contrato_kit: "2",
        id_assunto: "4",
        setor: "5",
        status: "AG",
        finalizada: false,
      },
    ]);
    expect(await crmCreateIxcServiceOrder.handler(entrada, contexto().ctx)).toMatchObject({
      existente: true,
      criada: false,
    });
    expect(criarOrdemIxc).not.toHaveBeenCalled();
  });
  it.each(["23505", "erro_banco"])(
    "não faz efeito quando reserva falha: %s",
    async (reservationError) => {
      expect(
        await crmCreateIxcServiceOrder.handler(entrada, contexto({ reservationError }).ctx),
      ).toMatchObject({ erro: "os_reserva_indisponivel" });
      expect(criarOrdemIxc).not.toHaveBeenCalled();
    },
  );
  it("timeout após reserva pede revisão sem afirmar sucesso", async () => {
    vi.mocked(criarOrdemIxc).mockRejectedValue(new Error("timeout"));
    const { ctx, inserts } = contexto();
    expect(await crmCreateIxcServiceOrder.handler(entrada, ctx)).toMatchObject({
      erro: "os_em_revisao",
      revisao_registrada: true,
    });
    expect(inserts.some((i) => i.table === "agent_inbox_items" && i.data.body)).toBe(true);
    expect(criarOrdemIxc).toHaveBeenCalledTimes(1);
  });
});
