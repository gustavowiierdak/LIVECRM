import { act, render, screen, waitFor } from "@testing-library/react";
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
  afterEach(() => {
    document.documentElement.setAttribute("data-theme", "light");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("mantém portal e menu de assuntos claros mesmo com preferência global escura", async () => {
    document.documentElement.setAttribute("data-theme", "dark");
    const user = userEvent.setup();
    const { container } = render(
      <PortalDeAtendimento marca="Marca teste" logoUrl={null} accent="#550CA1" />,
    );

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(container.querySelector("main")).toHaveAttribute("data-theme", "light");

    await user.click(screen.getByRole("button", { name: "Escolher assunto" }));
    const menu = await screen.findByRole("dialog");
    expect(menu).toHaveAttribute("data-theme", "light");
    expect(menu).toHaveClass("text-text");
    expect(menu).toHaveStyle({ "--atendimento-accent": "#550CA1" });
    expect(screen.getAllByText("Suporte técnico").length).toBeGreaterThan(0);
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("troca o setor sem criar uma conversa ou habilitar um envio sem sessão", async () => {
    const user = userEvent.setup();
    render(<PortalDeAtendimento marca="Marca teste" logoUrl={null} accent="#550CA1" />);

    const financeiro = screen.getByRole("button", { name: /Financeiro/ });
    expect(financeiro).toHaveAttribute("aria-pressed", "false");
    await user.click(financeiro);

    expect(financeiro).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Financeiro" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Mensagem" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enviar mensagem" })).not.toBeInTheDocument();
  });

  it("mostra somente os setores liberados no link público", () => {
    render(
      <PortalDeAtendimento
        marca="Marca teste"
        logoUrl={null}
        accent="#550CA1"
        publicId="05440000-7777-4000-8000-000000000001"
        setoresPermitidos={["financeiro"]}
      />,
    );

    expect(screen.getByRole("button", { name: /Financeiro/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByRole("button", { name: /Suporte técnico/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cancelamento/ })).not.toBeInTheDocument();
  });

  it("cliente abre o link e envia a primeira mensagem sem código", async () => {
    const message = {
      id: "initial-1",
      direction: "visitor",
      body: "Minha internet caiu",
      created_at: "2026-10-06T00:00:00Z",
    };
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
    render(
      <PortalDeAtendimento
        marca="Marca teste"
        logoUrl={null}
        accent="#550CA1"
        publicId={publicId}
      />,
    );
    expect(screen.queryByRole("textbox", { name: "Código de acesso" })).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Seu nome" }), "Cliente Novo");
    await user.type(screen.getByRole("textbox", { name: "Como podemos ajudar?" }), message.body);
    await user.click(screen.getByRole("button", { name: "Iniciar atendimento" }));
    expect(await screen.findByText(message.body)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/public/webchat/start",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining(`"public_id":"${publicId}"`),
      }),
    );
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

    expect(await screen.findByText("Conectado ao atendimento")).toBeInTheDocument();
    expect(screen.getByText("Conectado ao atendimento")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Financeiro" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Código de acesso" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Suporte técnico/ })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/public/webchat/consume", expect.anything());
  });

  it("retira o aviso quando a leitura das mensagens se recupera", async () => {
    let leituras = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/session"))
        return Response.json({ data: { sector: "financeiro" } });
      if (String(input).endsWith("/messages")) {
        leituras += 1;
        if (leituras === 1) throw new TypeError("Failed to fetch");
        return Response.json({ data: [] });
      }
      throw new Error(`Rota inesperada: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const intervalo = vi.spyOn(window, "setInterval");
    render(<PortalDeAtendimento marca="Marca teste" logoUrl={null} accent="#550CA1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível carregar as mensagens.",
    );
    const atualizar = intervalo.mock.calls.find(([, delay]) => delay === 7_000)?.[0];
    expect(typeof atualizar).toBe("function");
    if (typeof atualizar !== "function") return;
    act(() => atualizar());
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(leituras).toBe(2);
  });

  it("permite iniciar outro assunto sem misturar a conversa anterior", async () => {
    const publicId = "05440000-7777-4000-8000-000000000001";
    let novoIniciado = false;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/session")) return Response.json({ data: { sector: "suporte" } });
      if (String(input).endsWith("/messages"))
        return Response.json({
          data: novoIniciado
            ? [
                {
                  id: "new",
                  direction: "visitor",
                  body: "Preciso da segunda via",
                  created_at: "2026-10-06T12:05:00Z",
                },
              ]
            : [
                {
                  id: "old",
                  direction: "visitor",
                  body: "Conversa antiga",
                  created_at: "2026-10-06T12:00:00Z",
                },
              ],
        });
      if (String(input).endsWith("/start")) {
        novoIniciado = true;
        return Response.json(
          {
            data: {
              sector: "financeiro",
              message: {
                id: "new",
                direction: "visitor",
                body: "Preciso da segunda via",
                created_at: "2026-10-06T12:05:00Z",
              },
            },
          },
          { status: 201 },
        );
      }
      throw new Error(`Rota inesperada: ${String(input)} ${init?.method ?? "GET"}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <PortalDeAtendimento
        marca="Marca teste"
        logoUrl={null}
        accent="#550CA1"
        publicId={publicId}
      />,
    );

    expect(await screen.findByText("Conversa antiga")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Vamos iniciar seu atendimento" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Novo atendimento" }));
    expect(screen.queryByText("Conversa antiga")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Financeiro/ }));
    await user.type(screen.getByRole("textbox", { name: "Seu nome" }), "Cliente Novo");
    await user.type(
      screen.getByRole("textbox", { name: "Como podemos ajudar?" }),
      "Preciso da segunda via",
    );
    await user.click(screen.getByRole("button", { name: "Iniciar atendimento" }));

    expect(await screen.findByText("Preciso da segunda via")).toBeInTheDocument();
    expect(screen.queryByText("Conversa antiga")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/public/webchat/start",
      expect.objectContaining({
        body: expect.stringContaining('"sector":"financeiro"'),
      }),
    );
  });
});
