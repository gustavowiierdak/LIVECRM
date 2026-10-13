import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "@/lib/api/client";

import { VinculoIxcDoContato } from "./VinculoIxcDoContato";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));
vi.mock("@/lib/api/client", () => ({ apiClient: { post: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("vínculo IXC no cartão do contato", () => {
  beforeEach(() => vi.clearAllMocks());

  it("aceita CNPJ e aguarda escolha explícita entre cadastros", async () => {
    vi.mocked(apiClient.post)
      .mockResolvedValueOnce({
        data: {
          selection_required: true,
          clientes: [
            { id: "1", nome: "Matriz" },
            { id: "2", nome: "Filial" },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          customer_id: "2",
          customer_name: "Filial",
          linked_at: "2026-10-12",
          linked_by: "atendente",
        },
      });
    render(<VinculoIxcDoContato contactId="contato-1" readonly={false} initialLink={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Vincular cadastro do IXC" }));
    fireEvent.change(screen.getByLabelText("CPF/CNPJ do titular"), {
      target: { value: "12.345.678/0001-95" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Consultar e vincular" }));
    const selecionar = await screen.findByRole("button", { name: "2 · Filial" });
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    fireEvent.click(selecionar);
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenLastCalledWith("/api/v1/contacts/contato-1/ixc-link", {
        document: "12345678000195",
        customer_id: "2",
      }),
    );
    expect(await screen.findByText("Filial")).toBeInTheDocument();
  });

  it("mostra o id e a razão social já vinculados", () => {
    render(
      <VinculoIxcDoContato
        contactId="contato-1"
        readonly={false}
        initialLink={{
          customer_id: "17133",
          customer_name: "CLIENTE DE TESTE LTDA",
          linked_at: "2026-10-09T12:00:00.000Z",
          linked_by: "automatico",
        }}
      />,
    );
    expect(screen.getByText("17133")).toBeInTheDocument();
    expect(screen.getByText("CLIENTE DE TESTE LTDA")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alterar vínculo" })).toBeInTheDocument();
  });

  it("consulta o CPF e atualiza o cartão sem recarregar a conversa", async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      data: {
        customer_id: "17133",
        customer_name: "CLIENTE DE TESTE LTDA",
        linked_at: "2026-10-09T12:00:00.000Z",
        linked_by: "atendente",
      },
    });
    render(<VinculoIxcDoContato contactId="contato-1" readonly={false} initialLink={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Vincular cadastro do IXC" }));
    fireEvent.change(screen.getByLabelText("CPF/CNPJ do titular"), {
      target: { value: "123.456.789-09" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Consultar e vincular" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/api/v1/contacts/contato-1/ixc-link", {
        document: "12345678909",
      }),
    );
    expect(await screen.findByText("CLIENTE DE TESTE LTDA")).toBeInTheDocument();
    expect(screen.getByText("Vinculado por um atendente.")).toBeInTheDocument();
  });

  it("em acompanhamento somente leitura exibe o vínculo sem permitir alteração", () => {
    render(<VinculoIxcDoContato contactId="contato-1" readonly initialLink={null} />);
    expect(screen.getByText("Nenhum cadastro do IXC vinculado.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Vincular cadastro do IXC" }),
    ).not.toBeInTheDocument();
  });
});
