import { describe, expect, it } from "vitest";
import {
  atendimentoConfigPatchSchema,
  mesclarSettingsDeAtendimento,
  routingConfigSchema,
} from "@/lib/schemas/routing";

describe("configuração de inatividade", () => {
  const policy = { warn_after_minutes: 15, close_after_warning_minutes: 15 };
  it("nasce desligada e preserva escolha ao salvar formulário antigo", () => {
    expect(routingConfigSchema.parse({}).ai_inactivity).toBeUndefined();
    expect(
      mesclarSettingsDeAtendimento(
        { routing: { ai_inactivity: policy } },
        atendimentoConfigPatchSchema.parse({ mode: "manual" }),
      ).routing.ai_inactivity,
    ).toEqual(policy);
  });
  it("permite ativar e desligar explicitamente", () => {
    expect(
      mesclarSettingsDeAtendimento(
        {},
        atendimentoConfigPatchSchema.parse({ ai_inactivity: policy }),
      ).routing.ai_inactivity,
    ).toEqual(policy);
    expect(
      mesclarSettingsDeAtendimento(
        { routing: { ai_inactivity: policy } },
        atendimentoConfigPatchSchema.parse({ ai_inactivity: null }),
      ).routing.ai_inactivity,
    ).toBeNull();
  });
  it.each([0, 4, 1441, 15.5, "15"])("recusa prazo inválido %s", (value) => {
    expect(
      atendimentoConfigPatchSchema.safeParse({
        ai_inactivity: { ...policy, warn_after_minutes: value },
      }).success,
    ).toBe(false);
  });
});
