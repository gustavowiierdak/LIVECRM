import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { InboxRailProvider, useInboxRail } from "@/components/shell/InboxRail";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { InboxFiltersValue } from "@/components/inbox/InboxFilters";

/**
 * "LIMPAR FILTROS" LIMPA O CAMPO — SENÃO A TELA MENTE DE NOVO.
 *
 * O defeito que esta entrega inteira existe para matar é a tela AFIRMAR um
 * estado que o servidor não tem. O botão "Limpar filtros" reintroduzia
 * exatamente isso por outro caminho: zerava o filtro aplicado e deixava o termo
 * escrito na caixa de busca. A lista voltava cheia com um termo visível que já
 * não valia — e quem operasse leria a lista como resultado daquela busca.
 *
 * ─── Duas peças de idades diferentes ─────────────────────────────────────────
 * O campo guarda o texto em estado próprio desde abril (o debounce mora nele) e
 * nunca escutou o valor de fora. Isso nunca foi problema porque nada zerava esse
 * valor por fora. O botão é de setembro, e passou a zerar.
 *
 * ⛔ O par de controle é obrigatório aqui: um campo que adote o valor de fora
 * sem critério atropela quem continuou digitando depois do debounce — o conserto
 * viraria um defeito pior, e invisível em teste manual (só aparece para quem
 * digita rápido).
 *
 * ─── O que estes dois casos NÃO alcançam ─────────────────────────────────────
 * Eles reprovam a ausência do efeito de sincronização (medido: tirá-lo deixa o
 * primeiro vermelho). Não alcançam a marca `propagado.current = searchInput` do
 * timer: ela defende a fresta entre o timer disparar e o efeito rodar, e nessa
 * fresta nenhum teste consegue digitar — sabotá-la deixa os dois verdes, também
 * medido. Quem mexer ali não será avisado por estes testes; o aviso está escrito
 * no próprio componente.
 */
vi.mock("@/hooks/team/useSetores", () => ({ useSetores: () => ({ data: [] }) }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("@/hooks/channels/useChannelSessions", () => ({
  useChannelSessions: () => ({ data: [] }),
  channelLabel: () => "",
}));
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({ activeOrg: { orgId: "org-1", role: "admin", visibility_mode: "all" } }),
}));
vi.mock("@/hooks/inbox/useConversationTags", () => ({
  useConversationTagVocabulary: () => ({ data: [] }),
}));
vi.mock("@/hooks/contacts/useContactTagVocabulary", () => ({
  useContactTagVocabulary: () => ({ data: [] }),
}));
vi.mock("@/hooks/inbox/useConversationCounts", () => ({
  useConversationCounts: () => ({ data: undefined }),
}));

const { InboxFilters } = await import("@/components/inbox/InboxFilters");

/**
 * O arnês é o `InboxLayout` em miniatura: ele é o dono do estado, e o botão faz
 * o que `limparFiltrosAuxiliares` faz — zera a busca POR FORA do campo.
 * `search-aplicado` é a janela para o valor que já venceu o debounce; esperar
 * por ele é o que torna o teste determinístico sem relógio falso.
 */
function Arnes() {
  const [searchResetVersion, setSearchResetVersion] = useState(0);
  const [value, setValue] = useState<InboxFiltersValue>({
    tab: "all",
    search: "",
    onlyUnread: false,
  });
  return (
    <>
      <InboxFilters value={value} onChange={setValue} searchResetVersion={searchResetVersion} />
      <span data-testid="search-aplicado">{value.search}</span>
      <button onClick={() => {
        setSearchResetVersion((version) => version + 1);
        setValue((v) => ({ ...v, search: "", onlyUnread: false }));
      }}>
        Limpar filtros
      </button>
    </>
  );
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('"Limpar filtros" e o campo de busca', () => {
  it("limpar antes dos 250ms cancela o texto ainda não propagado e mantém o campo montado", () => {
    vi.useFakeTimers();
    try {
      render(<Arnes />);
      const campo = screen.getByLabelText("Buscar conversas");
      fireEvent.change(campo, { target: { value: "busca pendente" } });
      expect(screen.getByTestId("search-aplicado")).toHaveTextContent("");
      fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
      expect(screen.getByLabelText("Buscar conversas")).toBe(campo);
      expect(campo).toHaveValue("");
      act(() => vi.advanceTimersByTime(300));
      expect(screen.getByTestId("search-aplicado")).toBeEmptyDOMElement();
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });

  it("o campo volta a ficar vazio quando o filtro é limpo por fora", async () => {
    const user = userEvent.setup();
    render(<Arnes />);
    const campo = screen.getByLabelText("Buscar conversas");

    await user.type(campo, "zzqqxxnaoexiste");
    // Espera o debounce (250 ms) entregar o termo ao dono do estado.
    await screen.findByText("zzqqxxnaoexiste", {}, { timeout: 2_000 });

    await user.click(screen.getByRole("button", { name: "Limpar filtros" }));

    expect(campo, "o termo continuou escrito numa busca que não vale mais").toHaveValue("");
  });

  it("⛔ CONTROLE: o que ainda está sendo digitado NÃO é atropelado", async () => {
    const user = userEvent.setup();
    render(<Arnes />);
    const campo = screen.getByLabelText("Buscar conversas");

    await user.type(campo, "ab");
    await screen.findByText("ab", {}, { timeout: 2_000 });
    // A pessoa continua digitando DEPOIS de o debounce ter propagado "ab".
    await user.type(campo, "c");
    await new Promise((r) => setTimeout(r, 400));

    expect(campo, "o conserto reverteu a digitação em curso").toHaveValue("abc");
  });
});

function RailSlot() {
  const rail = useInboxRail();
  return <aside data-testid="rail"><div ref={rail?.setQueues} /></aside>;
}

describe("navegação compacta do atendimento", () => {
  it("recolhe filtros sem apagar a seleção, e mantém a contagem visível", async () => {
    const user = userEvent.setup();
    render(<Arnes />);
    const trigger = screen.getByRole("button", { name: "Filtros de atendimento" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Não lidos" })).not.toBeInTheDocument();
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Não lidos" }));
    await user.click(trigger);
    expect(trigger).toHaveTextContent("1");
    await user.click(trigger);
    expect(screen.getByRole("button", { name: "Não lidos" })).toHaveAttribute("aria-pressed", "true");
  });

  it("move as MESMAS abas para a lateral e devolve ao painel no celular", async () => {
    const listeners = new Set<() => void>();
    const media = {
      matches: true,
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    };
    vi.stubGlobal("matchMedia", () => media);
    const user = userEvent.setup();
    render(<InboxRailProvider><RailSlot /><Arnes /></InboxRailProvider>);
    const rail = screen.getByTestId("rail");
    expect(within(rail).getByRole("tablist")).toHaveAttribute("aria-orientation", "vertical");
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    await user.click(within(rail).getByRole("tab", { name: "Fila" }));
    expect(screen.getByRole("tab", { name: "Fila" })).toHaveAttribute("aria-selected", "true");
    act(() => { media.matches = false; listeners.forEach((listener) => listener()); });
    expect(within(rail).queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByRole("tablist")).toHaveAttribute("aria-orientation", "horizontal");
    expect(screen.getByRole("tab", { name: "Fila" })).toHaveAttribute("aria-selected", "true");
  });
});
