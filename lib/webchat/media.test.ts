import { describe, expect, it } from "vitest";

import { validarMidiaWebchat } from "./media";

describe("validação de anexos do atendimento web", () => {
  it("aceita imagem e gravação reais", () => {
    expect(validarMidiaWebchat("image/png", Uint8Array.from([137, 80, 78, 71, 0])))
      .toMatchObject({ kind: "image", ext: "png" });
    expect(validarMidiaWebchat("audio/webm;codecs=opus", Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3])))
      .toMatchObject({ kind: "audio", ext: "webm", mime: "audio/webm" });
  });

  it("recusa conteúdo disfarçado, tipo estranho, vazio e arquivo grande", () => {
    expect(validarMidiaWebchat("image/png", new TextEncoder().encode("<script>"))).toBeNull();
    expect(validarMidiaWebchat("text/html", new TextEncoder().encode("<script>"))).toBeNull();
    expect(validarMidiaWebchat("image/png", new Uint8Array(0))).toBeNull();
    expect(validarMidiaWebchat("image/png", new Uint8Array(10 * 1024 * 1024 + 1))).toBeNull();
  });
});
