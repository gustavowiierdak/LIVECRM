import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { listarFaturasBemobi, obterDadosPagamentoBemobi } from "@/lib/bemobi/client";
import { carregarIntegracaoBemobi } from "@/lib/bemobi/integration";
import { DEFAULT_CHANNEL_PROVIDER } from "@/lib/channels";
import { depsDoRitmo, registrarEnvioPorToken, segurarEnvioPorToken } from "@/lib/messaging/ritmo-do-envio-por-token";

import { crmListBemobiInvoices, crmSendBemobiPayment } from "./bemobi";
import { confirmarDocumentoDoTurno } from "./documento-confirmado";

import type { McpContext } from "../types";

vi.mock("@/app/api/v1/messages/_handler", () => ({ sendMessageHandler: vi.fn() }));
vi.mock("@/lib/bemobi/client", () => ({
  idDePagamentoBemobi: (fatura: { erpInvoiceId: string }) => fatura.erpInvoiceId,
  listarFaturasBemobi: vi.fn(),
  obterDadosPagamentoBemobi: vi.fn(),
}));
vi.mock("@/lib/bemobi/integration", () => ({ carregarIntegracaoBemobi: vi.fn() }));
vi.mock("@/lib/messaging/ritmo-do-envio-por-token", () => ({
  depsDoRitmo: vi.fn(),
  segurarEnvioPorToken: vi.fn(),
  registrarEnvioPorToken: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("./documento-confirmado", () => ({ confirmarDocumentoDoTurno: vi.fn() }));

const CONVERSA = "11111111-1111-4111-8111-111111111111";
const INPUT = {
  conversation_id: CONVERSA,
  document: "12345678909",
  invoice_id: "fatura-1",
  method: "pix" as const,
};

function contexto(provider: string = DEFAULT_CHANNEL_PROVIDER) {
  let reservado: { key: string; request_hash: string; response_body: Record<string, unknown> | null } | null = null;
  const avisoInsert = vi.fn(async () => ({ error: null }));
  const insert = vi.fn(async (row: { key: string; request_hash: string }) => {
    if (reservado) return { error: { code: "23505" } };
    reservado = { key: row.key, request_hash: row.request_hash, response_body: null };
    return { error: null };
  });
  const update = vi.fn((row: { response_body: Record<string, unknown> }) => {
    if (reservado) reservado.response_body = row.response_body;
    return { eq: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) };
  });
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data: reservado })),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  const from = vi.fn((table: string) => {
    if (table === "idempotency_keys") return { insert, update, ...query };
    if (table === "agent_inbox_items") {
      const aviso = {
        select: vi.fn(),
        eq: vi.fn(),
        limit: vi.fn(),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        insert: avisoInsert,
      };
      aviso.select.mockReturnValue(aviso);
      aviso.eq.mockReturnValue(aviso);
      aviso.limit.mockReturnValue(aviso);
      return aviso;
    }
    if (table === "conversations") {
      const conversa = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi.fn(async () => ({ data: { contact_id: "contato-1", channel_session_id: "sessao-1" } })),
      };
      conversa.select.mockReturnValue(conversa);
      conversa.eq.mockReturnValue(conversa);
      return conversa;
    }
    if (table === "channel_sessions") {
      const sessao = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi.fn(async () => ({ data: { provider } })),
      };
      sessao.select.mockReturnValue(sessao);
      sessao.eq.mockReturnValue(sessao);
      return sessao;
    }
    throw new Error(`tabela inesperada: ${table}`);
  });
  const ctx = {
    organizationId: "org-1",
    contatoDoTurno: "contato-1",
    sourceJobId: "job-1",
    requestId: "request-1",
    actor: { type: "agent", id: "agente-1" },
    supabase: { from },
  } as unknown as McpContext;
  return { ctx, insert, update, avisoInsert };
}

describe("envio financeiro Bemobi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(confirmarDocumentoDoTurno).mockResolvedValue({ ok: true, document: INPUT.document });
    vi.mocked(carregarIntegracaoBemobi).mockResolvedValue({
      ok: true,
      apiKey: "chave",
      resources: {
        invoices: true,
        payment_data: true,
        invoice_pdf: true,
        secure_portal: false,
        negotiation: false,
        recurrence: false,
        checkout: false,
      },
    });
    vi.mocked(listarFaturasBemobi).mockResolvedValue([{ erpInvoiceId: INPUT.invoice_id }] as never);
    vi.mocked(obterDadosPagamentoBemobi).mockResolvedValue({
      id: INPUT.invoice_id,
      amount: 50,
      pixCode: "codigo-de-teste",
    });
    vi.mocked(depsDoRitmo).mockResolvedValue({} as never);
    vi.mocked(segurarEnvioPorToken).mockResolvedValue({} as never);
    vi.mocked(registrarEnvioPorToken).mockResolvedValue(undefined as never);
    vi.mocked(sendMessageHandler).mockResolvedValue({
      id: "mensagem-1",
      status: "sent",
      sent_at: "2026-10-08T12:00:00Z",
    } as never);
  });

  it("consulta faturas com a política de CPF do financeiro", async () => {
    const { ctx } = contexto();
    await expect(crmListBemobiInvoices.handler({ document: INPUT.document }, ctx)).resolves.toMatchObject({
      total: 1,
    });
    expect(confirmarDocumentoDoTurno).toHaveBeenCalledWith(ctx, INPUT.document, "fatura");
  });

  it("reserva antes de enviar e usa chave do job, não a sugerida pelo modelo", async () => {
    const { ctx, insert, update } = contexto();
    const resposta = await crmSendBemobiPayment.handler(
      { ...INPUT, idempotency_key: "chave-arbitraria-do-modelo" }, ctx,
    );
    expect(resposta).toMatchObject({ message_id: "mensagem-1", status: "sent" });
    expect(confirmarDocumentoDoTurno).toHaveBeenCalledWith(ctx, INPUT.document, "fatura");
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0]?.[0].key).toMatch(/^bemobi:[a-f0-9]{64}$/);
    expect(update).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendMessageHandler).mock.calls[0]?.[2]).toMatchObject({
      metadata: { idempotency_key: insert.mock.calls[0]?.[0].key },
    });
  });

  it("repetição do mesmo turno devolve recibo sem reenviar", async () => {
    const { ctx } = contexto();
    await crmSendBemobiPayment.handler(INPUT, ctx);
    await expect(crmSendBemobiPayment.handler(INPUT, ctx)).resolves.toMatchObject({
      message_id: "mensagem-1", deduplicated: true,
    });
    expect(sendMessageHandler).toHaveBeenCalledTimes(1);
  });

  it("entrega PDF como link de texto na sessão web", async () => {
    const { ctx } = contexto("webchat");
    vi.mocked(obterDadosPagamentoBemobi).mockResolvedValueOnce({
      id: INPUT.invoice_id,
      amount: 50,
      invoicePDFURL: "https://faturas.example/segunda-via.pdf",
    } as never);
    await crmSendBemobiPayment.handler({ ...INPUT, method: "pdf" }, ctx);
    expect(vi.mocked(sendMessageHandler).mock.calls[0]?.[2]).toMatchObject({
      type: "text",
      body: expect.stringContaining("https://faturas.example/segunda-via.pdf"),
    });
  });

  it("reserva pendente falha fechada, sem segundo envio", async () => {
    const { ctx, avisoInsert } = contexto();
    vi.mocked(sendMessageHandler).mockRejectedValueOnce(new Error("falha após reserva"));
    await expect(crmSendBemobiPayment.handler(INPUT, ctx)).rejects.toThrow();
    await expect(crmSendBemobiPayment.handler(INPUT, ctx)).resolves.toMatchObject({
      erro: "envio_em_revisao",
    });
    expect(sendMessageHandler).toHaveBeenCalledTimes(1);
    expect(avisoInsert).toHaveBeenCalledWith(expect.objectContaining({
      organization_id: "org-1", ref_id: CONVERSA,
    }));
  });

  it("veto de ritmo não prende a chave nem envia pagamento", async () => {
    const { ctx, insert } = contexto();
    vi.mocked(segurarEnvioPorToken).mockRejectedValueOnce(new Error("limite do canal"));
    await expect(crmSendBemobiPayment.handler(INPUT, ctx)).rejects.toThrow("limite do canal");
    expect(insert).not.toHaveBeenCalled();
    expect(sendMessageHandler).not.toHaveBeenCalled();
  });

  it("fatura fora do CPF não consulta dados de pagamento nem envia", async () => {
    const { ctx, insert } = contexto();
    vi.mocked(listarFaturasBemobi).mockResolvedValueOnce([]);
    await expect(crmSendBemobiPayment.handler(INPUT, ctx)).resolves.toMatchObject({
      erro: "fatura_fora_do_contato",
    });
    expect(obterDadosPagamentoBemobi).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(sendMessageHandler).not.toHaveBeenCalled();
  });
});
