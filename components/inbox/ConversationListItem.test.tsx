/**
 * A etiqueta "Grupo" na lista de conversas.
 *
 * `conversations.is_group` já chega no `SELECT_COLS` do handler (schema
 * original) — este teste prende só a LEITURA na tela: quem abre o inbox
 * precisa distinguir uma conversa de grupo de uma individual sem abrir cada
 * uma. Props mínimas copiadas de `ConversationList.tsx`, via
 * `__fixtures__/conversa.ts`.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConversationListItem } from "./ConversationListItem";
import { conversaDeExemplo } from "./__fixtures__/conversa";
import { ProvedorDeCoresDasEtiquetas } from "@/components/tags/CoresDasEtiquetas";

const get = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiClient: { get: (...args: unknown[]) => get(...args) } }));
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({ activeOrg: { orgId: "org-1" } }),
}));

describe("ConversationListItem — etiqueta de grupo", () => {
  it("conversa de grupo tem a etiqueta Grupo", () => {
    render(
      <ConversationListItem
        conversation={{ ...conversaDeExemplo.conversation, is_group: true }}
        {...conversaDeExemplo.props}
      />,
    );
    expect(screen.getByText("Grupo")).toBeInTheDocument();
  });

  it("conversa individual não tem", () => {
    render(
      <ConversationListItem
        conversation={{ ...conversaDeExemplo.conversation, is_group: false }}
        {...conversaDeExemplo.props}
      />,
    );
    expect(screen.queryByText("Grupo")).toBeNull();
  });
});

/**
 * A bolinha no canto do avatar. A cor sai de quem está no comando, mas cor
 * sozinha não se explica — a palavra vem junto, no `title` e no nome acessível.
 */
describe("ConversationListItem — bolinha de quem atende", () => {
  it("a bolinha do avatar diz em palavras quem está no comando", () => {
    render(
      <ConversationListItem
        conversation={{
          ...conversaDeExemplo.conversation,
          assigned_to_user_id: "user-1",
          assigned_to_user_name: "Ana",
          assignee_kind: "user",
        }}
        {...conversaDeExemplo.props}
      />,
    );
    const bolinha = screen.getByRole("img", { name: "Em atendimento" });
    expect(bolinha).toHaveAttribute("title", "Em atendimento");
  });

  it("conversa encerrada: a bolinha diz Encerrada", () => {
    render(
      <ConversationListItem
        conversation={{ ...conversaDeExemplo.conversation, status: "closed" }}
        {...conversaDeExemplo.props}
      />,
    );
    expect(screen.getByRole("img", { name: "Encerrada" })).toHaveAttribute("title", "Encerrada");
  });

  // O caminho comum da aba de fechadas: alguém assumiu e fechou. Fechar não solta
  // o dono (`fn_service_status`), e `comandoDaConversa` segue dizendo `humano` de
  // propósito — mas a PALAVRA "Em atendimento" afirmaria um atendimento que acabou.
  it("conversa encerrada COM dono: a bolinha diz Encerrada, nunca Em atendimento", () => {
    render(
      <ConversationListItem
        conversation={{
          ...conversaDeExemplo.conversation,
          status: "closed",
          assigned_to_user_id: "user-1",
          assigned_to_user_name: "Ana",
          assignee_kind: "user",
        }}
        {...conversaDeExemplo.props}
      />,
    );
    expect(screen.getByRole("img", { name: "Encerrada" })).toHaveAttribute("title", "Encerrada");
    expect(screen.queryByRole("img", { name: "Em atendimento" })).toBeNull();
  });
});

describe("ConversationListItem — etiquetas acima da prévia", () => {
  it("exibe primeiro as etiquetas marcadas na conversa, sem perder as do contato", () => {
    render(
      <ConversationListItem
        conversation={{
          ...conversaDeExemplo.conversation,
          tags: ["suporte", "urgente"],
          contacts: { ...conversaDeExemplo.conversation.contacts!, tags: ["SUPORTE", "vip"] },
        }}
        {...conversaDeExemplo.props}
      />,
    );

    const content = screen.getByText("Maria").closest(".crm-list-content");
    expect(content).toBeInTheDocument();
    expect(content).toHaveTextContent("suporte");
    expect(content).toHaveTextContent("urgente");
    expect(content).toHaveTextContent("vip");
    expect(screen.queryByText("SUPORTE")).toBeNull();
    expect(screen.getByText("suporte").parentElement).toHaveClass("order-2");
    expect(screen.getByText("bom dia").parentElement).toHaveClass("order-3");
  });

  it("limita a quatro etiquetas para manter a lista compacta", () => {
    render(
      <ConversationListItem
        conversation={{
          ...conversaDeExemplo.conversation,
          tags: ["suporte", "urgente", "vip", "retorno", "financeiro"],
        }}
        {...conversaDeExemplo.props}
      />,
    );

    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.queryByText("financeiro")).toBeNull();
  });

  it("usa a cor configurada para a etiqueta da conversa", async () => {
    get.mockResolvedValue({ data: [{ tag: "suporte", cor: "#3e63dd" }] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ProvedorDeCoresDasEtiquetas>
          <ConversationListItem
            conversation={{ ...conversaDeExemplo.conversation, tags: ["suporte"] }}
            {...conversaDeExemplo.props}
          />
        </ProvedorDeCoresDasEtiquetas>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(get).toHaveBeenCalledWith("/api/v1/tags/cores"));
    await waitFor(() =>
      expect(screen.getByText("suporte")).toHaveStyle({ backgroundColor: "#3e63dd" }),
    );
  });
});
