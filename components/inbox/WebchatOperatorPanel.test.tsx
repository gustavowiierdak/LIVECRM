import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { AtendimentoOperadorWebchat } from "@/lib/webchat/types";
import { WebchatOperatorPanel } from "./WebchatOperatorPanel";

const SESSION_ID = "00000000-0000-4000-8000-000000000001";
vi.mock("@/hooks/auth/AuthProvider", () => ({ useAuth: () => ({ user: { id: "u1" }, activeOrg: { orgId: "o1" } }) }));
vi.mock("@/components/inbox/composer/EmojiButton", () => ({
  EmojiButton: ({ onPick, disabled }: { onPick: (emoji: string) => void; disabled?: boolean }) =>
    <button type="button" aria-label="Emoji" disabled={disabled} onClick={() => onPick("🙂")}>Emoji</button>,
}));

describe("WebchatOperatorPanel", () => {
  const fetchMock = vi.fn();
  let data: AtendimentoOperadorWebchat;
  let qc: QueryClient;
  const panel = (props: Partial<ComponentProps<typeof WebchatOperatorPanel>> = {}) => (
    <QueryClientProvider client={qc}><WebchatOperatorPanel key={props.conversationId ?? "c1"} conversationId="c1" {...props} /></QueryClientProvider>
  );
  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    data = { sessions: [{ id: SESSION_ID, sector: "suporte", expires_at: "2030-10-07T00:00:00Z", active: true }], selected_session_id: SESSION_ID, messages: [] };
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => Response.json({ data }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => { qc.clear(); vi.unstubAllGlobals(); });

  it("abre sessão e mensagens numa única leitura, com autoria e PDF seguro", async () => {
    data.messages = [
      { id: "ai", direction: "operator", sender_kind: "ai", body: "Segue o PIX", created_at: "2026-10-08T12:00:00Z" },
      { id: "pdf", direction: "operator", sender_kind: "human", sender_name: "Elson Andrade", type: "document", media_mime: "application/pdf", media_url: "https://faturas.example/teste.pdf", body: "Sua fatura", created_at: "2026-10-08T12:01:00Z" },
      { id: "bad", direction: "operator", type: "document", media_mime: "application/pdf", media_url: "javascript:alert(1)", body: "Indisponível", created_at: "2026-10-08T12:02:00Z" },
      { id: "visitor", direction: "visitor", body: "Obrigada", created_at: "2026-10-08T12:03:00Z" },
    ];
    render(panel({ contactName: "Ana Silva" }));
    expect(await screen.findByText("Segue o PIX")).toBeInTheDocument();
    expect(screen.getByText("IA")).toBeInTheDocument();
    expect(screen.getByText("Elson Andrade")).toHaveClass("crm-message-sender");
    expect(screen.getByText("Ana Silva")).toHaveClass("crm-message-sender");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Baixar PDF/ })).toHaveAttribute("href", "https://faturas.example/teste.pdf");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/conversations/c1/webchat/attendance");
  });

  it("mostra histórico em cache ao voltar e revalida sem misturar contatos", async () => {
    data.messages = [{ id: "a", direction: "visitor", body: "Histórico A", created_at: "2026-10-08T12:00:00Z" }];
    const view = render(panel());
    await screen.findByText("Histórico A");
    fetchMock.mockImplementation(() => new Promise(() => {}));
    view.rerender(panel({ conversationId: "c2" }));
    expect(screen.queryByText("Histórico A")).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    view.rerender(panel());
    expect(screen.getByText("Histórico A")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });

  it("troca de sessão sem exibir mensagens nem citação da anterior", async () => {
    const user = userEvent.setup();
    const secondId = "00000000-0000-4000-8000-000000000002";
    data.sessions.push({ id: secondId, sector: "financeiro", expires_at: "2030-10-07T00:00:00Z", active: true });
    data.messages = [{ id: "a", direction: "visitor", body: "Sessão anterior", created_at: "2026-10-08T12:00:00Z" }];
    render(panel());
    await screen.findByText("Sessão anterior");
    await user.click(screen.getByRole("button", { name: "Opções da mensagem" }));
    await user.click(screen.getByRole("menuitem", { name: "Responder citando" }));
    expect(screen.getByRole("region", { name: "Respondendo à mensagem" })).toBeVisible();
    fetchMock.mockImplementation(() => new Promise(() => {}));
    await user.selectOptions(screen.getByLabelText("Sessão ativa"), secondId);
    expect(screen.queryByText("Sessão anterior")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Respondendo à mensagem" })).toBeNull();
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining(`visitor_session_id=${secondId}`), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("envia para a sessão correta e atualiza sem apagar histórico", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        expect(body.visitor_session_id).toBe(SESSION_ID);
        const message = { id: "reply", direction: "operator" as const, body: body.body, created_at: "2026-10-08T12:00:00Z" };
        data.messages.push(message);
        return Response.json({ data: message });
      }
      return Response.json({ data });
    });
    render(panel());
    const input = await screen.findByLabelText("Responder pelo atendimento web");
    await user.click(screen.getByRole("button", { name: "Emoji" }));
    expect(input).toHaveValue("🙂");
    await user.clear(input);
    await user.type(input, "Resposta isolada{Enter}");
    expect(await screen.findByText("Resposta isolada")).toBeInTheDocument();
    const before = fetchMock.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Atualizar" }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
  });

  it("deixa a caixa do chat apenas para respostas; observações ficam na lateral", async () => {
    render(panel({ primary: true }));
    await screen.findByLabelText("Responder pelo atendimento web");
    expect(screen.queryByRole("button", { name: "Nota interna" })).not.toBeInTheDocument();
  });

  it("cita uma mensagem, mantém a prévia em falha e repete a mesma chave no retry", async () => {
    const user = userEvent.setup();
    const original = { id: "00000000-0000-4000-8000-000000000010", direction: "visitor" as const, body: "A luz LOS está vermelha", created_at: "2026-10-08T12:00:00Z" };
    data.messages = [original];
    const attempts: Record<string, unknown>[] = [];
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return Response.json({ data });
      const sent = JSON.parse(String(init.body));
      attempts.push(sent);
      if (attempts.length === 1) throw new TypeError("Falha de conexão");
      const message = { id: "reply", direction: "operator" as const, body: sent.body, reply_to: original, created_at: "2026-10-08T12:01:00Z" };
      data.messages.push(message);
      return Response.json({ data: message });
    });
    render(panel({ primary: true }));
    await screen.findByText(original.body);
    await user.click(screen.getByRole("button", { name: "Opções da mensagem" }));
    await user.click(screen.getByRole("menuitem", { name: "Responder citando" }));
    expect(screen.getByRole("region", { name: "Respondendo à mensagem" })).toHaveTextContent(original.body);
    const editor = screen.getByLabelText("Responder pelo atendimento web");
    expect(editor).toHaveFocus();
    await user.type(editor, "Vou verificar o sinal{Enter}");
    await screen.findByText("Falha de conexão");
    expect(editor).toHaveValue("Vou verificar o sinal");
    expect(screen.getByRole("region", { name: "Respondendo à mensagem" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(editor).toHaveValue(""));
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toEqual(attempts[1]);
    expect(attempts[1]).toMatchObject({ visitor_session_id: SESSION_ID, reply_to_message_id: original.id });
    expect(screen.queryByRole("region", { name: "Respondendo à mensagem" })).toBeNull();
    expect(screen.getByLabelText("Mensagem citada")).toHaveTextContent(original.body);
    await user.click(screen.getByRole("button", { name: "Atualizar" }));
    expect(await screen.findByLabelText("Mensagem citada")).toHaveTextContent(original.body);
  });

  it("permite cancelar a citação sem misturar observações internas ao rascunho", async () => {
    const user = userEvent.setup();
    data.messages = [{ id: "original", direction: "visitor", body: "Mensagem do cliente", created_at: "2026-10-08T12:00:00Z" }];
    render(panel({ primary: true }));
    await screen.findByText("Mensagem do cliente");
    const quote = async () => {
      await user.click(screen.getByRole("button", { name: "Opções da mensagem" }));
      await user.click(screen.getByRole("menuitem", { name: "Responder citando" }));
    };
    await quote();
    await user.click(screen.getByRole("button", { name: "Cancelar citação" }));
    expect(screen.queryByRole("region", { name: "Respondendo à mensagem" })).toBeNull();
    await quote();
    expect(screen.getByRole("region", { name: "Respondendo à mensagem" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Nota interna" })).not.toBeInTheDocument();
  });

  it("preserva histórico encerrado e impede responder", async () => {
    data.sessions = data.sessions.map((session) => ({ ...session, active: false }));
    data.messages = [{ id: "old", direction: "visitor", body: "Mensagem anterior", created_at: "2026-10-05T00:00:00Z" }];
    render(panel({ primary: true }));
    expect(await screen.findByText("Mensagem anterior")).toBeInTheDocument();
    expect(screen.getByLabelText("Responder pelo atendimento web")).toBeDisabled();
  });

  it("recupera sessão criada depois e distingue erro de vazio", async () => {
    const user = userEvent.setup();
    const connected = data;
    data = { sessions: [], selected_session_id: "", messages: [] };
    render(panel());
    await screen.findByText("Nenhum visitante conectado por este canal.");
    data = connected;
    await user.click(screen.getByRole("button", { name: "Atualizar" }));
    await screen.findByLabelText("Responder pelo atendimento web");
    fetchMock.mockResolvedValue(Response.json({ error: { message: "Falha de leitura" } }, { status: 500 }));
    await user.click(screen.getByRole("button", { name: "Atualizar" }));
    expect(await screen.findByText("Falha de leitura")).toBeInTheDocument();
  });

  it("emite código de handoff apenas pelo comando explícito", async () => {
    const user = userEvent.setup();
    data = { sessions: [], selected_session_id: "", messages: [] };
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("webchat-handoffs")) {
        expect(JSON.parse(String(init?.body))).toEqual({ sector: "financeiro" });
        return Response.json({ data: { handoff_token: "codigo-unico" } });
      }
      return Response.json({ data });
    });
    render(panel());
    await screen.findByText("Nenhum visitante conectado por este canal.");
    await user.selectOptions(screen.getByLabelText("Setor"), "financeiro");
    await user.click(screen.getByRole("button", { name: "Gerar código de acesso" }));
    expect(await screen.findByText("codigo-unico")).toBeInTheDocument();
  });
});
