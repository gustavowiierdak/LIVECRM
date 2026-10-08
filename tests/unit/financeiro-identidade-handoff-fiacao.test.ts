import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const fonte = fs.readFileSync(
  path.join(process.cwd(), "lib/agent-engine/agent/inbound-turn.ts"),
  "utf8",
);

describe("recusa de identidade financeira no turno real", () => {
  it("intercepta a recusa da ferramenta e passa a conversa para uma pessoa depois de avisar", () => {
    const inicio = fonte.indexOf("name === 'crm_list_bemobi_invoices'");
    const fim = fonte.indexOf("if (\n              (name === 'crm_search_products'", inicio);
    expect(inicio).toBeGreaterThan(-1);
    expect(fim).toBeGreaterThan(inicio);
    const trecho = fonte.slice(inicio, fim);
    expect(trecho).toContain("resultado.erro === 'cpf_nao_confirmado'");
    expect(trecho).toContain("identidadeFinanceiraRecusada = true");
    expect(trecho.indexOf("avisarLeadDaEscalacao(")).toBeLessThan(
      trecho.indexOf("applyRequestHumanHandoff("),
    );
    expect(trecho).toContain("if (!preview)");
  });

  it("impede que o modelo envie uma promessa depois da recusa", () => {
    const inicio = fonte.indexOf("send_message: tool({");
    expect(inicio).toBeGreaterThan(-1);
    const trecho = fonte.slice(inicio, inicio + 1400);
    expect(trecho).toContain("if (identidadeFinanceiraRecusada)");
    expect(trecho).toContain("code: 'identidade_financeira_nao_confirmada'");
  });

  it("liga o fechamento após fatura ao fim do turno real, sem reprocessar o envio", () => {
    const fechamento = fonte.indexOf('encerrarConversaAposFatura(pool, {');
    const conclusao = fonte.indexOf("runLog.info('turno do agente concluído'", fechamento);
    expect(fechamento).toBeGreaterThan(-1);
    expect(conclusao).toBeGreaterThan(fechamento);
    const trecho = fonte.slice(fechamento - 600, conclusao);
    expect(trecho).toContain("liveJob().kind === 'inbound_turn'");
    expect(trecho).toContain('despedidaSimples(currentInboundText');
    expect(trecho).toContain("item.kind === 'sent'");
    expect(trecho).toContain("action: 'conversation.closed'");
  });
});
