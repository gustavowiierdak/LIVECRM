import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationNotesPanel } from "./ConversationNotesPanel";

const state = vi.hoisted(() => ({
  notes: [] as Array<{ id: string; created_at: string; body: string; created_by_user_id: string }>,
  isError: false,
  refetch: vi.fn(),
  deleted: vi.fn(),
}));

vi.mock("@/hooks/auth/AuthProvider", () => ({
  usePermission: () => true,
  useActiveOrg: () => ({ role: "agent" }),
  useUser: () => ({ id: "u1" }),
}));
vi.mock("@/hooks/inbox/useConversationNotes", () => ({
  useConversationNotesQuery: () => ({
    data: state.notes,
    isPending: false,
    isError: state.isError,
    refetch: state.refetch,
  }),
}));
vi.mock("@/hooks/inbox/useDeleteNote", () => ({
  useDeleteNote: () => ({ mutate: state.deleted }),
}));
vi.mock("./Composer", () => ({
  Composer: ({ fixedMode }: { fixedMode: string }) => <div data-testid="editor-observacao">{fixedMode}</div>,
}));
vi.mock("./NoteCard", () => ({
  NoteCard: ({ note, onDelete }: { note: { body: string }; onDelete?: () => void }) => (
    <article>{note.body}{onDelete && <button onClick={onDelete}>Excluir nota</button>}</article>
  ),
}));

describe("ConversationNotesPanel", () => {
  beforeEach(() => {
    state.notes = [];
    state.isError = false;
    state.refetch.mockClear();
    state.deleted.mockClear();
  });

  it("mostra observações recentes na lateral e abre editor privado", async () => {
    const user = userEvent.setup();
    state.notes = [
      { id: "n1", created_at: "2026-10-15T10:00:00Z", body: "Antiga", created_by_user_id: "u1" },
      { id: "n2", created_at: "2026-10-15T11:00:00Z", body: "Recente", created_by_user_id: "u1" },
      { id: "n3", created_at: "2026-10-15T12:00:00Z", body: "Última", created_by_user_id: "u1" },
    ];
    render(<ConversationNotesPanel conversationId="c1" readonly={false} />);
    const panel = screen.getByTestId("inbox-observacoes");
    expect(screen.getByRole("heading", { name: "Observações internas" })).toBeInTheDocument();
    expect(panel).not.toHaveTextContent("Só a equipe vê");
    expect(panel).toHaveTextContent("Última");
    expect(panel).toHaveTextContent("Recente");
    expect(panel).not.toHaveTextContent("Antiga");
    await user.click(screen.getByRole("button", { name: "Ver todas" }));
    expect(panel).toHaveTextContent("Antiga");
    await user.click(screen.getByRole("button", { name: "Nova observação" }));
    expect(screen.getByTestId("editor-observacao")).toHaveTextContent("note");
  });

  it("mantém histórico legível sem permitir escrita em atendimento somente leitura", () => {
    state.notes = [{ id: "n1", created_at: "2026-10-15T12:00:00Z", body: "Registrada", created_by_user_id: "u1" }];
    render(<ConversationNotesPanel conversationId="c1" readonly />);
    expect(screen.getByText("Registrada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nova observação" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Excluir nota" })).not.toBeInTheDocument();
  });

  it("distingue erro de leitura de lista vazia e oferece nova tentativa", async () => {
    const user = userEvent.setup();
    state.isError = true;
    render(<ConversationNotesPanel conversationId="c1" readonly={false} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível carregar as observações.");
    expect(screen.queryByText("Nenhuma observação nesta conversa.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(state.refetch).toHaveBeenCalledOnce();
  });
});
