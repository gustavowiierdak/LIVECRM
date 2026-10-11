import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WebchatOperatorPanel } from "./WebchatOperatorPanel";

const SESSION_ID = "00000000-0000-4000-8000-000000000001";
const createNote = vi.hoisted(() => vi.fn(async () => ({ data: {} })));

vi.mock("@/hooks/inbox/useConversationNotes", () => ({
  useConversationNotes: () => [],
}));
vi.mock("@/hooks/inbox/useCreateNote", () => ({
  useCreateNote: () => ({ mutateAsync: createNote, isPending: false }),
}));
vi.mock("@/components/inbox/composer/EmojiButton", () => ({
  EmojiButton: ({ onPick, disabled }: { onPick: (emoji: string) => void; disabled?: boolean }) => (
    <button type="button" aria-label="Emoji" disabled={disabled} onClick={() => onPick("🙂")}>
      Emoji
    </button>
  ),
}));

describe("WebchatOperatorPanel", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    createNote.mockClear();
    fetchMock.mockClear();
    fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("webchat-sessions")) return Response.json({ data: [] });
      if (url.includes("webchat-handoffs")) {
        expect(init?.method).toBe("POST");
        expect(init?.body).toBe(JSON.stringify({ sector: "financeiro" }));
        return Response.json({
          data: { handoff_token: "codigo-unico", expires_at: "2026-10-07T00:00:00Z" },
        });
      }
      return Response.json({ data: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("mostra estado honesto sem visitante e emite o código uma única vez", async () => {
    const user = userEvent.setup();
    render(<WebchatOperatorPanel conversationId="11111111-1111-4111-8111-111111111111" />);

    expect(
      await screen.findByText("Nenhum visitante conectado por este canal."),
    ).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Setor"), "financeiro");
    await user.click(screen.getByRole("button", { name: "Gerar código de acesso" }));

    expect(await screen.findByText("codigo-unico")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/webchat-handoffs"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("isola a resposta na sessão selecionada", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("webchat-sessions")) {
        return Response.json({
          data: [
            { id: SESSION_ID, sector: "suporte", expires_at: "2026-10-07T00:00:00Z", active: true },
          ],
        });
      }
      if (url.includes("webchat/messages?") && !init?.method) return Response.json({ data: [] });
      if (url.endsWith("/webchat/messages")) {
        const body = JSON.parse(String(init?.body)) as { visitor_session_id: string; body: string };
        expect(body.visitor_session_id).toBe(SESSION_ID);
        expect(body.body).toBe("Resposta isolada");
        return Response.json({
          data: {
            id: "message-1",
            direction: "operator",
            body: "Resposta isolada",
            created_at: "2026-10-06T00:00:00Z",
          },
        });
      }
      return Response.json({ data: [] });
    });

    render(<WebchatOperatorPanel conversationId="11111111-1111-4111-8111-111111111111" />);
    const input = await screen.findByLabelText("Responder pelo atendimento web");
    await user.click(screen.getByRole("button", { name: "Emoji" }));
    expect(input).toHaveValue("🙂");
    await user.clear(input);
    await user.type(input, "Resposta isolada");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.getByText("Resposta isolada")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`visitor_session_id=${SESSION_ID}`),
      expect.anything(),
    );

    const leiturasAntes = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes(`visitor_session_id=${SESSION_ID}`),
    ).length;
    await user.click(screen.getByRole("button", { name: "Atualizar" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) =>
          String(url).includes(`visitor_session_id=${SESSION_ID}`),
        ).length,
      ).toBeGreaterThan(leiturasAntes),
    );
  });

  it("identifica a resposta automática como IA, sem atribuí-la ao operador", async () => {
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("webchat-sessions")) return Response.json({ data: [
        { id: SESSION_ID, sector: "financeiro", expires_at: "2030-10-07T00:00:00Z", active: true },
      ] });
      if (url.includes("webchat/messages?")) return Response.json({ data: [
        { id: "ai-1", direction: "operator", sender_kind: "ai", body: "Segue o PIX",
          created_at: "2026-10-08T12:00:00Z" },
      ] });
      return Response.json({ data: [] });
    });
    render(<WebchatOperatorPanel conversationId="11111111-1111-4111-8111-111111111111" />);
    expect(await screen.findByText("Segue o PIX")).toBeInTheDocument();
    expect(screen.getByText(/IA ·/)).toBeInTheDocument();
    expect(screen.queryByText(/Você ·/)).not.toBeInTheDocument();
  });

  it("salva nota interna sem enviar texto ao visitante", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("webchat-sessions")) {
        return Response.json({
          data: [
            { id: SESSION_ID, sector: "suporte", expires_at: "2026-10-07T00:00:00Z", active: true },
          ],
        });
      }
      return Response.json({ data: [] });
    });

    render(<WebchatOperatorPanel conversationId="11111111-1111-4111-8111-111111111111" primary />);
    await screen.findByLabelText("Responder pelo atendimento web");
    await user.click(screen.getByRole("button", { name: "Nota interna" }));
    const input = screen.getByLabelText("Responder pelo atendimento web");
    await user.type(input, "Contexto só para a equipe");
    await user.click(screen.getByRole("button", { name: "Salvar nota" }));

    await waitFor(() =>
      expect(createNote).toHaveBeenCalledWith({
        conversation_id: "11111111-1111-4111-8111-111111111111",
        body: "Contexto só para a equipe",
      }),
    );
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => String(url).endsWith("/webchat/messages") && init?.method === "POST",
      ),
    ).toHaveLength(0);
  });

  it("mantém o histórico visível após a sessão expirar, sem permitir resposta", async () => {
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("webchat-sessions"))
        return Response.json({
          data: [
            {
              id: SESSION_ID,
              sector: "suporte",
              expires_at: "2026-10-05T00:00:00Z",
              active: false,
            },
          ],
        });
      if (url.includes("webchat/messages?"))
        return Response.json({
          data: [
            {
              id: "message-old",
              direction: "visitor",
              body: "Mensagem anterior",
              created_at: "2026-10-05T00:00:00Z",
            },
          ],
        });
      return Response.json({ data: [] });
    });

    render(<WebchatOperatorPanel conversationId="11111111-1111-4111-8111-111111111111" primary />);
    expect(await screen.findByText("Mensagem anterior")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Suporte — Sessão encerrada" })).toBeInTheDocument();
    expect(screen.getByLabelText("Responder pelo atendimento web")).toBeDisabled();
  });

  it("detecta automaticamente uma sessão criada após a abertura do painel", async () => {
    let conectado = false;
    const timers: Array<() => void> = [];
    const setIntervalOriginal = window.setInterval.bind(window);
    const intervalSpy = vi
      .spyOn(window, "setInterval")
      .mockImplementation((handler, timeout, ...args) => {
        if (typeof handler === "function") timers.push(() => handler(...args));
        return setIntervalOriginal(handler, timeout, ...args) as unknown as NodeJS.Timeout;
      });
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      if (String(input).includes("webchat-sessions"))
        return Response.json({
          data: conectado
            ? [
                {
                  id: SESSION_ID,
                  sector: "suporte",
                  expires_at: "2026-10-07T00:00:00Z",
                  active: true,
                },
              ]
            : [],
        });
      return Response.json({ data: [] });
    });

    render(<WebchatOperatorPanel conversationId="11111111-1111-4111-8111-111111111111" />);
    expect(
      await screen.findByText("Nenhum visitante conectado por este canal."),
    ).toBeInTheDocument();
    conectado = true;
    await act(async () => timers[0]?.());
    expect(await screen.findByLabelText("Responder pelo atendimento web")).toBeInTheDocument();
    intervalSpy.mockRestore();
  });
});
