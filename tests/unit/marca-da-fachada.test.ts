import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MarcaDeSaida } from "@/lib/branding/saida";

const dublês = vi.hoisted(() => ({
  resposta: { data: [] as unknown[], error: null as null | { code?: string; message: string } },
  explodir: false,
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
  marcaDaSaida: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({
  cache: <T extends (...args: never[]) => unknown>(funcao: T) => funcao,
}));
vi.mock("@/lib/logger", () => ({ logger: { warn: dublês.warn } }));
vi.mock("@/lib/branding/saida", () => ({ marcaDaSaida: dublês.marcaDaSaida }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (dublês.explodir) throw new Error("banco indisponível");
    return { from: dublês.from };
  },
}));

const marcaDaInstalacao: MarcaDeSaida = {
  nome: "DeskcommCRM",
  logoUrl: "https://storage.test/platform/logo.png",
  logoDarkUrl: null,
  accent: "#506d48",
  accentFg: "#ffffff",
  origens: { nome: "banco", cor: "banco" },
};

const marcaDaOrganizacao: MarcaDeSaida = {
  nome: "Nome antigo da marca",
  logoUrl: "https://storage.test/org/logo.png",
  logoDarkUrl: "https://storage.test/org/logo-dark.png",
  accent: "#123456",
  accentFg: "#ffffff",
  origens: { nome: "organizacao", cor: "organizacao" },
};

async function carregar() {
  vi.resetModules();
  return import("@/lib/branding/fachada");
}

beforeEach(() => {
  dublês.resposta = { data: [], error: null };
  dublês.explodir = false;
  vi.clearAllMocks();

  dublês.from.mockReturnValue({ select: dublês.select });
  dublês.select.mockReturnValue({ eq: dublês.eq });
  dublês.eq.mockReturnValue({ order: dublês.order });
  dublês.order.mockReturnValue({ limit: dublês.limit });
  dublês.limit.mockImplementation(async () => dublês.resposta);
  dublês.marcaDaSaida.mockImplementation(async (organizationId: string | null) =>
    organizationId ? marcaDaOrganizacao : marcaDaInstalacao,
  );
});

describe("marcaDaFachada", () => {
  it("com uma organização ativa usa o logo dela e o display_name no login", async () => {
    dublês.resposta.data = [
      { id: "11111111-1111-4111-8111-111111111111", display_name: "Live Internet" },
    ];
    const { marcaDaFachada } = await carregar();

    const marca = await marcaDaFachada();

    expect(marca).toEqual({
      ...marcaDaOrganizacao,
      nome: "Live Internet",
      origens: { nome: "organizacao.display_name", cor: "organizacao" },
    });
    expect(dublês.marcaDaSaida).toHaveBeenNthCalledWith(1, null);
    expect(dublês.marcaDaSaida).toHaveBeenNthCalledWith(2, "11111111-1111-4111-8111-111111111111");
  });

  it("com duas organizações não escolhe uma identidade antes do login", async () => {
    dublês.resposta.data = [
      { id: "11111111-1111-4111-8111-111111111111", display_name: "Empresa A" },
      { id: "22222222-2222-4222-8222-222222222222", display_name: "Empresa B" },
    ];
    const { marcaDaFachada } = await carregar();

    await expect(marcaDaFachada()).resolves.toEqual(marcaDaInstalacao);
    expect(dublês.marcaDaSaida).toHaveBeenCalledTimes(1);
    expect(dublês.marcaDaSaida).toHaveBeenCalledWith(null);
  });

  it("degrada para a instalação quando a leitura das organizações falha", async () => {
    dublês.resposta.error = { code: "08006", message: "conexão recusada" };
    const { marcaDaFachada } = await carregar();

    await expect(marcaDaFachada()).resolves.toEqual(marcaDaInstalacao);
    expect(dublês.warn).toHaveBeenCalledOnce();
  });

  it("consulta somente campos públicos e limita a leitura a duas organizações ativas", async () => {
    const { marcaDaFachada } = await carregar();

    await marcaDaFachada();

    expect(dublês.from).toHaveBeenCalledWith("organizations");
    expect(dublês.select).toHaveBeenCalledWith("id, display_name");
    expect(dublês.eq).toHaveBeenCalledWith("status", "active");
    expect(dublês.order).toHaveBeenCalledWith("created_at", { ascending: true });
    expect(dublês.limit).toHaveBeenCalledWith(2);
  });

  it("não derruba a tela quando nem o cliente administrativo pode ser criado", async () => {
    dublês.explodir = true;
    const { marcaDaFachada } = await carregar();

    await expect(marcaDaFachada()).resolves.toEqual(marcaDaInstalacao);
    expect(dublês.warn).toHaveBeenCalledOnce();
  });
});
