import { describe, expect, it } from "vitest";

import {
  digestWebchat,
  mensagemWebchatSchema,
  novaCredencialOpaca,
  opcoesCookieWebchat,
  originDaRequisicao,
} from "./seguranca";

describe("segurança do webchat", () => {
  it("nunca persiste a credencial opaca em texto puro", () => {
    const credential = novaCredencialOpaca();
    expect(credential.raw).not.toBe(credential.digest);
    expect(credential.digest).toBe(digestWebchat(credential.raw));
    expect(credential.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("aceita somente Origin canônico para a proteção CSRF", () => {
    expect(
      originDaRequisicao(
        new Request("https://portal.local", { headers: { origin: "https://portal.local" } }),
      ),
    ).toBe("https://portal.local");
    expect(
      originDaRequisicao(
        new Request("https://portal.local", {
          headers: { origin: "https://portal.local/caminho" },
        }),
      ),
    ).toBeNull();
    expect(originDaRequisicao(new Request("https://portal.local"))).toBeNull();
    expect(
      originDaRequisicao(
        new Request("https://portal.local", { headers: { origin: "https://usuario@portal.local" } }),
      ),
    ).toBeNull();
  });

  it("exige chave UUID para a mensagem idempotente", () => {
    expect(
      mensagemWebchatSchema.safeParse({
        body: "  Mensagem única  ",
        idempotency_key: "00000000-0000-4000-8000-000000000001",
      }),
    ).toMatchObject({ success: true, data: { body: "Mensagem única" } });
    expect(mensagemWebchatSchema.safeParse({ body: "ok", idempotency_key: "retry-1" }).success).toBe(
      false,
    );
  });

  it("leva a sessão HttpOnly às rotas seguras fora da página pública", () => {
    const cookie = opcoesCookieWebchat("2030-01-01T00:00:00.000Z", true);
    expect(cookie.path).toBe("/");
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("strict");
  });
});
