import { describe, expect, it } from "vitest";

import { corrigirMotivoDeVetoLegado } from "@/lib/leads/legacy-veto-activity";
import { vetoReason } from "@/lib/leads/veto-activity";

const legacy = {
  id: "atividade-antiga",
  type: "send_vetoed",
  reason: "Não enviei: o contato pediu para parar de receber mensagens",
  payload: { gate: "stop", code: "contato_bloqueado" },
};

describe("motivo do veto na atividade", () => {
  it("registra o motivo específico nos vetos novos", () => {
    expect(vetoReason("stop", "contato_bloqueado")).toBe(legacy.reason);
    expect(vetoReason("stop", "automatico_pausado_para_humano"))
      .toBe("Não enviei: o automático foi pausado para atendimento humano");
    expect(vetoReason("stop", "contato_pessoal"))
      .toBe("Não enviei: o contato está marcado como pessoal");
  });

  it("corrige o falso opt-out histórico para pausa humana só na leitura", () => {
    const corrigida = corrigirMotivoDeVetoLegado(legacy, { is_blocked: false, force_human: true });
    expect(corrigida.reason).toBe("Não enviei: o automático foi pausado para atendimento humano");
    expect(legacy.reason).toBe("Não enviei: o contato pediu para parar de receber mensagens");
  });

  it("preserva opt-out real e não reclassifica outros vetos", () => {
    expect(corrigirMotivoDeVetoLegado(legacy, { is_blocked: true, force_human: true })).toBe(legacy);
    expect(corrigirMotivoDeVetoLegado({ ...legacy, payload: { gate: "window", code: "outside_window" } },
      { force_human: true })).toMatchObject({ reason: legacy.reason });
  });

  it("não inventa motivo quando o estado atual não o confirma", () => {
    expect(corrigirMotivoDeVetoLegado(legacy, {}).reason)
      .toBe("Não enviei: pausa automática sem motivo confirmado");
  });
});
