import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WebchatSettingsForm } from "./_webchat-form";

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

describe("configuração visual do atendimento web", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("mostra o link compartilhável somente quando a origem da página está liberada", async () => {
    const publicId = "05440000-5555-4000-8000-000000000001";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      data: {
        enabled: true,
        public_id: publicId,
        allowed_sectors: ["suporte"],
        allowed_origins: [window.location.origin],
        handoff_ttl_seconds: 900,
      },
    })));
    render(<WebchatSettingsForm />);

    expect(await screen.findByLabelText("Link para clientes")).toHaveValue(
      `${window.location.origin}/atendimento/${publicId}`,
    );
    expect(screen.getByRole("link", { name: "Abrir página" })).toHaveAttribute(
      "href", `/atendimento/${publicId}`,
    );
  });

  it("avisa quando a origem atual impediria o cliente de iniciar o atendimento", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      data: {
        enabled: true,
        public_id: "05440000-5555-4000-8000-000000000002",
        allowed_sectors: ["suporte"],
        allowed_origins: ["https://outro.example"],
        handoff_ttl_seconds: 900,
      },
    })));
    render(<WebchatSettingsForm />);

    expect(await screen.findByRole("alert")).toHaveTextContent(window.location.origin);
    expect(screen.queryByLabelText("Link para clientes")).not.toBeInTheDocument();
  });

  it("mostra o canal desligado e salva setor, origem e validade pela tela", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method)
        return Response.json({
          data: {
            enabled: false,
            allowed_sectors: [],
            allowed_origins: [],
            handoff_ttl_seconds: 900,
          },
        });
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return Response.json({ data: body });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<WebchatSettingsForm />);

    expect(
      await screen.findByText("O canal vem desligado até você configurá-lo.", { exact: false }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("checkbox", { name: "Permitir atendimento web nesta empresa" }),
    );
    await user.click(screen.getByRole("checkbox", { name: "Financeiro" }));
    await user.type(
      screen.getByLabelText("Endereços permitidos"),
      "https://crm.liveinternet.com.br",
    );
    await user.clear(screen.getByLabelText("Validade do código, em minutos"));
    await user.type(screen.getByLabelText("Validade do código, em minutos"), "20");
    await user.click(screen.getByRole("button", { name: "Salvar atendimento web" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/settings/webchat",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            enabled: true,
            allowed_sectors: ["financeiro"],
            allowed_origins: ["https://crm.liveinternet.com.br"],
            handoff_ttl_seconds: 1200,
          }),
        }),
      ),
    );
  });
});
