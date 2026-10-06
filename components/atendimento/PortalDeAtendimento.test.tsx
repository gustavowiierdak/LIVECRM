import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PortalDeAtendimento } from "./PortalDeAtendimento";

describe("PortalDeAtendimento", () => {
  beforeEach(() =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: { message: "sem sessão" } }, { status: 401 })),
    ),
  );
  afterEach(() => vi.unstubAllGlobals());

  it("troca o setor sem criar uma conversa ou habilitar um envio sem sessão", async () => {
    const user = userEvent.setup();
    render(<PortalDeAtendimento marca="Marca teste" logoUrl={null} accent="#550CA1" />);

    const financeiro = screen.getByRole("button", { name: /Financeiro/ });
    expect(financeiro).toHaveAttribute("aria-pressed", "false");
    await user.click(financeiro);

    expect(financeiro).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Financeiro" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Mensagem" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Enviar mensagem" })).toBeDisabled();
    expect(
      screen.getByText(
        /O envio permanece bloqueado até você iniciar o atendimento/,
      ),
    ).toBeInTheDocument();
  });

  it("mostra somente os setores liberados no link público", () => {
    render(<PortalDeAtendimento marca="Marca teste" logoUrl={null} accent="#550CA1"
      publicId="05440000-7777-4000-8000-000000000001" setoresPermitidos={["financeiro"]} />);

    expect(screen.getByRole("button", { name: /Financeiro/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: /Suporte técnico/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cancelamento/ })).not.toBeInTheDocument();
  });

  it("cliente abre o link e envia a primeira mensagem sem código", async () => {
    const message = { id: "initial-1", direction: "visitor", body: "Minha internet caiu",
      created_at: "2026-10-06T00:00:00Z" };
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      if (String(input).endsWith("/session"))
        return Response.json({ error: { message: "sem sessão" } }, { status: 401 });
      if (String(input).endsWith("/start"))
        return Response.json({ data: { sector: "suporte", message } }, { status: 201 });
      return Response.json({ data: [message] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const publicId = "05440000-7777-4000-8000-000000000001";
    render(<PortalDeAtendimento marca="Marca teste" logoUrl={null} accent="#550CA1"
      publicId={publicId} />);
    expect(screen.queryByRole("textbox", { name: "Código de acesso" })).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Seu nome" }), "Cliente Novo");
    await user.type(screen.getByRole("textbox", { name: "Como podemos ajudar?" }), message.body);
    await user.click(screen.getByRole("button", { name: "Iniciar atendimento" }));
    expect(await screen.findByText(message.body)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/public/webchat/start", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining(`"public_id":"${publicId}"`),
    }));
    expect(screen.getByRole("textbox", { name: "Mensagem" })).toBeEnabled();
  });

  it("busca respostas da equipe somente depois de consumir o código", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/session")) {
        return Response.json({ error: { message: "sem sessão" } }, { status: 401 });
      }
      if (String(input).endsWith("/consume")) {
        return Response.json({ data: { sector: "suporte" } });
      }
      return Response.json({
        data: [
          {
            id: "reply-1",
            direction: "operator",
            body: "Resposta da equipe",
            created_at: "2026-10-06T00:00:00Z",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<PortalDeAtendimento marca="Marca teste" logoUrl={null} accent="#550CA1" />);

    await user.type(screen.getByRole("textbox", { name: "Código de acesso" }), "codigo-local");
    await user.click(screen.getByRole("button", { name: "Validar" }));

    expect(await screen.findByText("Resposta da equipe")).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/public/webchat/messages",
        expect.objectContaining({ credentials: "same-origin" }),
      ),
    );
  });

  it("retoma a sessão por cookie após recarregar, sem reutilizar o código", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/session"))
        return Response.json({ data: { sector: "financeiro" } });
      return Response.json({ data: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PortalDeAtendimento marca="Marca teste" logoUrl={null} accent="#550CA1" />);

    expect(
      await screen.findByText(
        "Atendimento seguro iniciado. A equipe recebe apenas esta conversa web.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Conectado ao atendimento")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Financeiro" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Código de acesso" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Suporte técnico/ })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/public/webchat/consume", expect.anything());
  });
});
