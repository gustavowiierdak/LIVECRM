import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { derivarMarca } from "@/lib/branding/contraste";
import { REGUA_DO_PRODUTO } from "@/lib/branding/regua-do-produto";
import type { MarcaResolvida } from "@/lib/branding/resolve";

/**
 * O LOGO NA FACHADA — as telas que existem antes de qualquer sessão.
 *
 * POR QUE ESTE ARQUIVO EXISTE: até esta onda o login renderizava só texto, e
 * `platform_branding.logo_url` não tinha um único leitor no produto. Quem
 * instala o sistema para clientes mostra a marca dele exatamente aqui — é a
 * primeira tela que o cliente do revendedor abre na vida, e a última que alguém
 * lembra de conferir.
 *
 * ── Por que renderizar o LAYOUT, e não a página ───────────────────────────────
 *
 * O `<img>` mora em `app/(public)/layout.tsx` porque são SEIS telas no grupo
 * (login, cadastro, recuperação, redefinição, MFA, códigos de recuperação) e uma
 * cópia por página divergiria na primeira vez que alguém mexesse numa só. O
 * teste segue o código: mede a casca, que é onde a decisão está.
 *
 * ── Por que `renderToStaticMarkup`, e não Testing Library ─────────────────────
 *
 * É um Server Component async: `render()` da Testing Library não sabe esperar a
 * promessa. Chamar a função e renderizar a árvore que ela devolve é o caminho
 * honesto — e mede o HTML de verdade, não a presença do símbolo `logoUrl` no
 * arquivo.
 */

const marcaDaFachada = vi.hoisted(() => vi.fn());
vi.mock("@/lib/branding/fachada", () => ({ marcaDaFachada }));
// A casca passou a resolver o idioma da interface (ver `IdiomaProvider` no
// próprio layout) e por isso chama `createClient()`, que lê cookies — algo que
// só existe dentro de uma requisição real. Fora do login quase nunca há
// sessão, e o mock reflete exatamente isso: nenhum usuário.
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
  })),
}));

const MARCA: MarcaResolvida = {
  name: "Vendas Turbo",
  initial: "V",
  logoUrl: null,
  cor: {
    semente: "#5b21b6",
    papel: "accent",
    derivada: derivarMarca("#5b21b6", REGUA_DO_PRODUTO),
  },
  origens: { nome: "organizacao", logoUrl: "padrao", cor: "organizacao" },
  motivos: [],
};

async function fachada(marca: MarcaResolvida): Promise<string> {
  marcaDaFachada.mockResolvedValue(marca);
  const { default: PublicLayout } = await import("@/app/(public)/layout");
  return renderToStaticMarkup(await PublicLayout({ children: <p>formulário</p> }));
}

describe("a casca das telas de acesso", () => {
  beforeEach(() => {
    vi.resetModules();
    marcaDaFachada.mockReset();
  });

  it("com logo configurado, a fachada o desenha", async () => {
    const html = await fachada({ ...MARCA, logoUrl: "https://cdn.exemplo.test/revenda.png" });

    expect(html).toContain('src="https://cdn.exemplo.test/revenda.png"');
    // Legendado com a marca DESTA resolução: é ela que produziu a imagem.
    expect(html).toContain('alt="Vendas Turbo"');
    // Guarda de vacuidade: sem o conteúdo, a asserção de cima poderia estar
    // medindo uma casca que engoliu o formulário de login.
    expect(html).toContain("formulário");
  });

  it("sem logo, nenhuma imagem — e nunca um `src` vazio", async () => {
    const html = await fachada(MARCA);

    // `<img src="">` faz o navegador pedir a própria página e desenhar o ícone
    // de imagem quebrada no topo do login. É o estado de fábrica de TODA
    // instalação nova, então o caminho normal não pode ter esse defeito.
    expect(html).not.toContain("<img");
    expect(html).toContain("formulário");
  });

  it("a cor da organização única vira CSS escopado às telas públicas", async () => {
    const html = await fachada(MARCA);

    expect(html).toContain('data-marca-fachada=""');
    expect(html).toContain('id="marca-fachada"');
    expect(html).toContain("body:has([data-marca-fachada])");
    expect(html).toContain("--color-accent:");
    expect(html).toContain("--color-accent-fg:");
  });
});
