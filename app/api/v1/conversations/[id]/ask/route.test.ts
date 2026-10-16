import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/agent-engine/db/request-pool", () => ({ getRequestPool: vi.fn() }));
vi.mock("@/lib/agent-engine/agent/request-deps", () => ({
  requestTurnDeps: vi.fn(() => ({ llmCfg: {} })),
}));
vi.mock("@/lib/agent-engine/agent/conversa-do-caso", () => ({ responderSobreOCaso: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { responderSobreOCaso } from "@/lib/agent-engine/agent/conversa-do-caso";
import { POST } from "./route";

const ORG = "22222222-2222-4222-8222-222222222222";
const CONVERSA = "33333333-3333-4333-8333-333333333333";
const CONTATO = "44444444-4444-4444-8444-444444444444";

function requisicao(pergunta: string) {
  return new NextRequest(`http://local/api/v1/conversations/${CONVERSA}/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pergunta }),
  });
}

function banco({ visivel = true, anonimizado = false } = {}) {
  const consultas: string[] = [];
  const client = {
    from(tabela: string) {
      consultas.push(tabela);
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({
          data:
            tabela === "conversations"
              ? visivel
                ? { id: CONVERSA, contact_id: CONTATO, service_started_at: null }
                : null
              : { id: CONTATO, is_anonymized: anonimizado },
          error: null,
        }),
      };
      return chain;
    },
  };
  return { client, consultas };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: "user-1", idioma: "pt" },
    org: { orgId: ORG },
  } as never);
});

describe("perguntar sobre o atendimento", () => {
  it("não inventa diagnóstico quando o cliente só enviou imagens", async () => {
    const db = banco();
    vi.mocked(createClient).mockResolvedValue(db.client as never);
    vi.mocked(getRequestPool).mockReturnValue({
      query: vi.fn(async () => ({
        rows: [
          {
            direction: "inbound",
            type: "image",
            body: "Imagem enviada",
            media_derived_text: null,
            sent_via: "crm",
            sent_at: "2026-10-16T09:00:00Z",
          },
        ],
      })),
    } as never);

    const res = await POST(requisicao("Qual é o problema do cliente?"), {
      params: Promise.resolve({ id: CONVERSA }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.resposta).toContain("Anexos sem descrição");
    expect(responderSobreOCaso).not.toHaveBeenCalled();
  });

  it("envia pergunta diferente com o histórico desta conversa ao modelo", async () => {
    vi.mocked(createClient).mockResolvedValue(banco().client as never);
    const query = vi.fn(async () => ({
      rows: [
        {
          direction: "inbound",
          type: "text",
          body: "A internet caiu em todos os aparelhos",
          media_derived_text: null,
          sent_via: "crm",
          sent_at: "2026-10-16T09:00:00Z",
        },
      ],
    }));
    vi.mocked(getRequestPool).mockReturnValue({ query } as never);
    vi.mocked(responderSobreOCaso)
      .mockResolvedValueOnce({ texto: "Relatou queda geral", callId: "call-1", agentId: null })
      .mockResolvedValueOnce({
        texto: "Informou que foi em todos",
        callId: "call-2",
        agentId: null,
      });

    const ctx = { params: Promise.resolve({ id: CONVERSA }) };
    const primeira = await POST(requisicao("Qual é o problema?"), ctx);
    const segunda = await POST(requisicao("Em quais aparelhos?"), ctx);
    expect((await primeira.json()).data.resposta).toBe("Relatou queda geral");
    expect((await segunda.json()).data.resposta).toBe("Informou que foi em todos");
    expect(vi.mocked(responderSobreOCaso).mock.calls[0]?.[2]).toMatchObject({
      pergunta: "Qual é o problema?",
      blocoDeDados: expect.stringContaining("A internet caiu em todos os aparelhos"),
    });
    expect(vi.mocked(responderSobreOCaso).mock.calls[1]?.[2]).toMatchObject({
      pergunta: "Em quais aparelhos?",
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("organization_id = $1"), [
      ORG,
      CONVERSA,
      null,
    ]);
  });

  it("não lê mensagens nem chama IA se a conversa não é visível", async () => {
    vi.mocked(createClient).mockResolvedValue(banco({ visivel: false }).client as never);
    const pool = vi.fn();
    vi.mocked(getRequestPool).mockImplementation(pool);
    const res = await POST(requisicao("Qual é o problema?"), {
      params: Promise.resolve({ id: CONVERSA }),
    });
    expect(res.status).toBe(404);
    expect(pool).not.toHaveBeenCalled();
  });

  it("não reconstrói caso de contato anonimizado", async () => {
    vi.mocked(createClient).mockResolvedValue(banco({ anonimizado: true }).client as never);
    const res = await POST(requisicao("Qual é o problema?"), {
      params: Promise.resolve({ id: CONVERSA }),
    });
    expect(res.status).toBe(422);
    expect(responderSobreOCaso).not.toHaveBeenCalled();
  });
});
