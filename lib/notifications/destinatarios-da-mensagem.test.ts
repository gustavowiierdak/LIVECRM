import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/agents/org-tem-automatico", () => ({
  orgTemAutomatico: vi.fn(async () => true),
}));

import { orgTemAutomatico } from "@/lib/ai/agents/org-tem-automatico";
import {
  carregarDestinatariosDaMensagem,
  destinatariosDaMensagem,
  usuarioRecebeAviso,
  type LeitorDeAtribuicao,
} from "./destinatarios-da-mensagem";

const BASE = {
  comando: "automatico", atribuidoA: null, setorId: "setor-suporte",
  membrosDoSetor: ["ana", "bia"], atendentesAtivos: ["ana", "caio"],
};

describe("destinatariosDaMensagem", () => {
  it("silencia mensagem enquanto IA ou robô atende, mesmo com setor e dono de negócio", () => {
    expect(destinatariosDaMensagem(BASE).userIds).toEqual([]);
  });

  it("fila do setor avisa apenas membros ativos daquele setor", () => {
    expect(destinatariosDaMensagem({ ...BASE, comando: "aguardando" }).userIds).toEqual(["ana"]);
  });

  it("sem setor definido avisa atendentes ativos; não avisa viewer", () => {
    expect(destinatariosDaMensagem({ ...BASE, comando: "aguardando", setorId: null }).userIds).toEqual(["ana", "caio"]);
  });

  it("conversa assumida avisa apenas o responsável humano", () => {
    const destino = destinatariosDaMensagem({ ...BASE, comando: "humano", atribuidoA: "bia" });
    expect(destino.userIds).toEqual(["bia"]);
    expect(usuarioRecebeAviso(destino, "bia")).toBe(true);
    expect(usuarioRecebeAviso(destino, "ana")).toBe(false);
  });

  it("sem robô configurado, automático é fila; sem saber o estado, não amplia avisos", () => {
    expect(destinatariosDaMensagem({ ...BASE, automaticoDaOrg: false }).userIds).toEqual(["ana"]);
    expect(destinatariosDaMensagem({ ...BASE, automaticoDaOrg: undefined }).userIds).toEqual([]);
  });

  it("encerrado não produz novo aviso", () => {
    expect(destinatariosDaMensagem({ ...BASE, comando: "encerrada", atribuidoA: "ana" }).userIds).toEqual([]);
  });
});

function stub(tabelas: Record<string, { data: unknown; error?: { message: string } | null }>) {
  const consultas: Array<{ tabela: string; filtros: Array<[string, string, unknown]> }> = [];
  const db: LeitorDeAtribuicao = {
    from(tabela: string) {
      const registro = { tabela, filtros: [] as Array<[string, string, unknown]> };
      consultas.push(registro);
      const resultado = { data: tabelas[tabela]?.data ?? null, error: tabelas[tabela]?.error ?? null };
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (registro.filtros.push(["eq", c, v]), q),
        is: (c: string, v: unknown) => (registro.filtros.push(["is", c, v]), q),
        in: (c: string, v: unknown) => (registro.filtros.push(["in", c, v]), q),
        maybeSingle: async () => resultado,
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resultado).then(ok, ko),
      };
      return q;
    },
  };
  return { db, consultas };
}

describe("carregarDestinatariosDaMensagem", () => {
  const conversa = (comando: string, atribuidoA: string | null = null, setorId: string | null = "s1") => ({
    status: "open", assigned_to_user_id: atribuidoA, atendimento_setor_id: setorId, comando_da_conversa: comando,
  });

  it("IA ativa: não consulta equipe nem envia aviso", async () => {
    vi.mocked(orgTemAutomatico).mockResolvedValueOnce(true);
    const { db, consultas } = stub({ conversations: { data: conversa("automatico") } });
    expect(await carregarDestinatariosDaMensagem(db, "org-1", "conv-1")).toEqual({ tipo: "restrito", userIds: [] });
    expect(consultas.map((c) => c.tabela)).toEqual(["conversations"]);
  });

  it("handoff para fila: cruza setor e usuários ativos, com filtro de organização", async () => {
    const { db, consultas } = stub({
      conversations: { data: conversa("aguardando") },
      atendimento_setor_membros: { data: [{ user_id: "ana" }, { user_id: "bia" }] },
      user_organizations: { data: [{ user_id: "ana" }, { user_id: "caio" }] },
    });
    expect(await carregarDestinatariosDaMensagem(db, "org-1", "conv-1")).toEqual({ tipo: "restrito", userIds: ["ana"] });
    for (const c of consultas) expect(c.filtros).toContainEqual(["eq", "organization_id", "org-1"]);
    expect(consultas.find((c) => c.tabela === "atendimento_setor_membros")?.filtros).toContainEqual(["eq", "setor_id", "s1"]);
    expect(consultas.find((c) => c.tabela === "user_organizations")?.filtros).toContainEqual(["is", "revoked_at", null]);
  });

  it("atendente assumiu: só ele, sem procurar outros setores ou donos comerciais", async () => {
    const { db, consultas } = stub({ conversations: { data: conversa("humano", "bia") } });
    expect(await carregarDestinatariosDaMensagem(db, "org-1", "conv-1")).toEqual({ tipo: "restrito", userIds: ["bia"] });
    expect(consultas.map((c) => c.tabela)).toEqual(["conversations"]);
  });

  it("conversa encerrada com histórico de responsável não gera aviso", async () => {
    const { db } = stub({ conversations: { data: { ...conversa("humano", "bia"), status: "closed" } } });
    expect(await carregarDestinatariosDaMensagem(db, "org-1", "conv-1")).toEqual({ tipo: "restrito", userIds: [] });
  });

  it("conversa ausente retorna null; erro de leitura não vira aviso para todos", async () => {
    expect(await carregarDestinatariosDaMensagem(stub({}).db, "org-1", "conv-x")).toBeNull();
    await expect(carregarDestinatariosDaMensagem(stub({ conversations: { data: null, error: { message: "boom" } } }).db, "org-1", "conv-1")).rejects.toThrow("boom");
  });
});
