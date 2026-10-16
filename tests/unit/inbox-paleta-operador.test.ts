import fs from "node:fs";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { razaoDeContraste } from "@/lib/branding/contraste";

function contraste(a: string | undefined, b: string | undefined): number {
  if (!a || !b) throw new Error("Token de cor ausente na paleta");
  return razaoDeContraste(a, b);
}

const css = postcss.parse(fs.readFileSync("app/app/_components/workspace.module.css", "utf8"));
const escopo = ".workspace :global(.crm-inbox)";
const base = `:global(:root:root) :global(body):has(${escopo})`;
const escuro = `:global(:root:root[data-theme="dark"]) :global(body):has(${escopo})`;
const superficies = `:global(:root[data-theme="dark"]):has(${escopo})`;

function tokens(seletor: string): Record<string, string> {
  const resultado: Record<string, string> = {};
  css.walkRules(seletor, (regra) => {
    regra.walkDecls((decl) => {
      resultado[decl.prop] = decl.value;
    });
  });
  expect(Object.keys(resultado).length).toBeGreaterThan(0);
  return resultado;
}

describe("paleta do atendimento inspirada na referência OPA", () => {
  it("mantém ações violeta separadas dos textos para legibilidade no escuro", () => {
    const claro = tokens(base);
    const dark = tokens(escuro);
    const fundos = tokens(superficies);
    expect(claro["--workspace-action"]).toBe("#4434cc");
    expect(
      contraste(claro["--workspace-action"], claro["--workspace-action-fg"]),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contraste(claro["--workspace-action-hover"], claro["--workspace-action-fg"]),
    ).toBeGreaterThanOrEqual(4.5);
    for (const fundo of [fundos["--color-surface"], fundos["--workspace-message-incoming"]]) {
      expect(contraste(dark["--color-accent"], fundo)).toBeGreaterThanOrEqual(4.5);
      expect(
        contraste(
          tokens(':global(:root[data-theme="dark"]):has(.workspace)')["--color-text"],
          fundo,
        ),
      ).toBeGreaterThanOrEqual(4.5);
      expect(contraste(fundos["--color-text-muted"], fundo)).toBeGreaterThanOrEqual(4.5);
    }
    expect(fundos["--workspace-message-incoming"]).toBe(fundos["--workspace-message-outgoing"]);
  });

  it("limita a nova cor ao Inbox montado, inclusive nos portais", () => {
    let regras = 0;
    css.walkRules((regra) => {
      let sobrescrevePaleta = false;
      regra.walkDecls((decl) => {
        if (decl.prop.startsWith("--workspace-action") || decl.prop.startsWith("--color-accent"))
          sobrescrevePaleta = true;
      });
      if (!sobrescrevePaleta) return;
      regras += 1;
      expect(regra.selector).toContain(`:global(body):has(${escopo})`);
    });
    expect(regras).toBe(2);
    expect(tokens(base)["--primary"]).toBe("var(--workspace-action)");
    expect(tokens(base)["--popover"]).toBe("var(--color-surface)");
    expect(tokens(`:global(body):has(${escopo}) :global(.bg-accent)`)["background-color"]).toBe(
      "var(--workspace-action)",
    );
  });
});
