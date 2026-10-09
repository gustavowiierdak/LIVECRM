import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  consultaIxcLiberouDiagnosticoTecnico,
  omitirAusenciaDeBloqueioFinanceiro,
} from "./ixc-comunicacao";

describe("comunicação do diagnóstico financeiro do IXC", () => {
  it("reconhece somente o resultado estruturado que libera o diagnóstico técnico", () => {
    expect(
      consultaIxcLiberouDiagnosticoTecnico({
        encontrado: true,
        bloqueio_financeiro: false,
        diagnostico: "sem_bloqueio_financeiro_no_ixc",
      }),
    ).toBe(true);
    expect(
      consultaIxcLiberouDiagnosticoTecnico({
        encontrado: true,
        bloqueio_financeiro: true,
        diagnostico: "bloqueio_financeiro_confirmado",
      }),
    ).toBe(false);
    expect(consultaIxcLiberouDiagnosticoTecnico({ encontrado: false })).toBe(false);
  });

  it("omite a frase financeira e mantém as perguntas técnicas", () => {
    expect(
      omitirAusenciaDeBloqueioFinanceiro(
        "Verifiquei que o acesso ativo não está com bloqueio financeiro.\n\n" +
          "A falha começou quando? Ela acontece em todos os aparelhos ou só em um?",
      ),
    ).toEqual({
      texto: "A falha começou quando? Ela acontece em todos os aparelhos ou só em um?",
      removeu: true,
    });
  });

  it.each([
    "O IXC não indicou bloqueio financeiro. Reinicie o modem.",
    "Não há bloqueio financeiro no acesso. Vamos verificar o sinal.",
    "O contrato está sem bloqueio financeiro. A luz LOS está acesa?",
    "Seu acesso não está bloqueado por pendência financeira. Qual luz está vermelha?",
  ])("remove outras formas de revelar o resultado interno: %s", (texto) => {
    const resultado = omitirAusenciaDeBloqueioFinanceiro(texto);
    expect(resultado.removeu).toBe(true);
    expect(resultado.texto).not.toMatch(/bloqueio financeiro|pendência financeira/i);
  });

  it("não altera a confirmação quando há bloqueio financeiro", () => {
    const texto =
      "O acesso está com bloqueio financeiro. Quer que eu faça o desbloqueio de confiança?";
    expect(omitirAusenciaDeBloqueioFinanceiro(texto)).toEqual({ texto, removeu: false });
  });

  it("liga o resultado da consulta à filtragem do send_message", () => {
    const fonte = readFileSync(new URL("./inbound-turn.ts", import.meta.url), "utf8");
    expect(fonte).toMatch(
      /ixcLiberouDiagnosticoTecnico\s*=\s*consultaIxcLiberouDiagnosticoTecnico\(resultado\)/,
    );
    expect(fonte).toMatch(
      /ixcLiberouDiagnosticoTecnico\s*\?\s*omitirAusenciaDeBloqueioFinanceiro\(corpoFormatado\)/,
    );
  });

  it("impede que o modelo transforme a ausência de bloqueio em passagem humana", () => {
    const fonte = readFileSync(new URL("./inbound-turn.ts", import.meta.url), "utf8");
    const inicioDaTool = fonte.indexOf("request_human_handoff: tool({");
    const fimDaTool = fonte.indexOf("// F3-02:", inicioDaTool);
    const ferramenta = fonte.slice(inicioDaTool, fimDaTool);

    expect(inicioDaTool).toBeGreaterThan(-1);
    expect(ferramenta).toMatch(
      /if \(ixcLiberouDiagnosticoTecnico\)[\s\S]*code: "diagnostico_tecnico_pendente"/,
    );
    expect(ferramenta.indexOf("if (ixcLiberouDiagnosticoTecnico)")).toBeLessThan(
      ferramenta.indexOf("passouParaAEquipe = true"),
    );
    expect(ferramenta).toContain("Continue atendendo e use send_message");
  });
});
