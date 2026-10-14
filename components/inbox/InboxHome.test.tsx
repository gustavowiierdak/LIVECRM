import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InboxHome } from "./InboxHome";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiClient: { get } }));

const counts = { fila: 19, unassigned: 20, mine: 2, automatico: 4, closed: 0, all: 25 };
function mount(initialData?: typeof counts) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (initialData) client.setQueryData(["conversation-counts", "org-test", ""], initialData);
  const actions = { onQueue: vi.fn(), onSearch: vi.fn(), onHelp: vi.fn() };
  render(<QueryClientProvider client={client}><InboxHome orgId="org-test" name="Operador de teste" {...actions} /></QueryClientProvider>);
  return actions;
}

describe("início do operador", () => {
  beforeEach(() => { get.mockReset(); get.mockResolvedValue({ data: counts }); });

  it("mostra as contagens canônicas, incluindo zero real, sem somar visões sobrepostas", async () => {
    mount();
    expect(await within(screen.getByRole("button", { name: "Abrir Fila" })).findByText("19")).toBeVisible();
    expect(within(screen.getByRole("button", { name: "Abrir Minhas" })).getByText("2")).toBeVisible();
    expect(within(screen.getByRole("button", { name: "Abrir Automático" })).getByText("4")).toBeVisible();
    expect(within(screen.getByRole("button", { name: "Abrir Fechadas" })).getByText("0")).toBeVisible();
    expect(get).toHaveBeenCalledWith("/api/v1/conversations/counts");
    expect(screen.queryByRole("button", { name: "Abrir Todas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Assumir/ })).not.toBeInTheDocument();
  });

  it("carregando não se transforma em zero", () => {
    get.mockReturnValue(new Promise(() => {}));
    mount();
    expect(screen.getByRole("status")).toHaveTextContent("Carregando contagens…");
    expect(screen.getAllByLabelText("Contagem indisponível")).toHaveLength(4);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("cache antigo usa unassigned sem inventar os campos ausentes", async () => {
    get.mockResolvedValue({ data: { unassigned: 7, mine: 0, all: 7 } });
    mount();
    expect(await within(screen.getByRole("button", { name: "Abrir Fila" })).findByText("7")).toBeVisible();
    expect(screen.getAllByLabelText("Contagem indisponível")).toHaveLength(2);
  });

  it("erro de atualização esconde o número antigo, oferece retry e recupera", async () => {
    get.mockRejectedValueOnce(new Error("offline"));
    mount(counts);
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível atualizar as contagens.");
    expect(screen.getAllByLabelText("Contagem indisponível")).toHaveLength(4);
    expect(screen.queryByText("19")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(within(screen.getByRole("button", { name: "Abrir Fila" })).getByText("19")).toBeVisible();
  });

  it("atalhos usam somente callbacks de navegação, por mouse e teclado", async () => {
    const actions = mount();
    for (const [label, tab] of [["Fila", "unassigned"], ["Minhas", "mine"], ["Automático", "ai"], ["Fechadas", "closed"]]) {
      const button = screen.getByRole("button", { name: `Abrir ${label}` });
      button.focus();
      await userEvent.keyboard("{Enter}");
      expect(actions.onQueue).toHaveBeenLastCalledWith(tab);
    }
    await userEvent.click(screen.getByRole("button", { name: "Buscar conversas" }));
    await userEvent.click(screen.getByRole("button", { name: "Atalhos de teclado" }));
    expect(actions.onSearch).toHaveBeenCalledOnce();
    expect(actions.onHelp).toHaveBeenCalledOnce();
  });
});
