import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorNotificationPrompt } from "./OperatorNotificationPrompt";

const state = vi.hoisted(() => ({
  permission: "default",
  enabled: false,
  pushStatus: "idle",
  request: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@/hooks/notifications/useNotificationPermission", () => ({
  useNotificationPermission: () => state,
}));
vi.mock("@/lib/notifications/prefs", () => ({ gravarCanal: state.save }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (text: string) => text }));
beforeEach(() => {
  window.localStorage.clear();
  state.permission = "default";
  state.enabled = false;
  state.pushStatus = "idle";
  state.request.mockReset().mockResolvedValue("granted");
  state.save.mockClear();
});

describe("porta de notificações do atendente", () => {
  it("pede permissão apenas no clique e habilita a preferência de mensagens", async () => {
    render(<OperatorNotificationPrompt compact />);
    expect(state.request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ativar notificações" }));
    expect(state.request).toHaveBeenCalledOnce();
    await waitFor(() => expect(state.save).toHaveBeenCalledWith("message", "push", true));
  });
  it("bloqueio do navegador tem orientação e não tenta pedir de novo", () => {
    state.permission = "denied";
    render(<OperatorNotificationPrompt compact />);
    expect(screen.getByRole("status")).toHaveTextContent("Libere Notificações");
    expect(screen.queryByRole("button", { name: "Ativar notificações" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Configurar avisos" })).toHaveAttribute(
      "href",
      "/app/settings/notifications",
    );
  });
  it("permissão concedida não esconde servidor sem push", () => {
    state.permission = "granted";
    state.enabled = true;
    state.pushStatus = "server_unavailable";
    render(<OperatorNotificationPrompt />);
    expect(screen.getByRole("status")).toHaveTextContent("servidor ainda não está configurado");
    expect(screen.queryByText("Notificações ativadas")).not.toBeInTheDocument();
  });
  it("não repete o aviso compacto a cada F5 quando a permissão já foi concedida", () => {
    state.permission = "granted";
    state.enabled = true;
    state.pushStatus = "syncing";
    const view = render(<OperatorNotificationPrompt compact />);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    view.unmount();
    state.pushStatus = "error";
    render(<OperatorNotificationPrompt compact />);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
  it("erro nativo é recuperável e não liga preferência", async () => {
    state.request.mockRejectedValue(new Error("browser"));
    render(<OperatorNotificationPrompt compact />);
    fireEvent.click(screen.getByRole("button", { name: "Ativar notificações" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("tente novamente");
    expect(state.save).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeEnabled();
  });
  it("a recusa não é convertida em ativação", async () => {
    state.request.mockResolvedValue("denied");
    render(<OperatorNotificationPrompt compact />);
    fireEvent.click(screen.getByRole("button", { name: "Ativar notificações" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Ativar notificações" })).toBeEnabled(),
    );
    expect(state.save).not.toHaveBeenCalled();
  });
  it("some da fila só após inscrição confirmada; diagnóstico permanece nos ajustes", () => {
    state.permission = "granted";
    state.enabled = true;
    state.pushStatus = "ready";
    const view = render(<OperatorNotificationPrompt compact />);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    view.rerender(<OperatorNotificationPrompt />);
    expect(screen.getByRole("status")).toHaveTextContent("inclusive com a aba fechada");
  });
  it("pode ser dispensado sem desligar avisos ou perder a porta de configurações", () => {
    const view = render(<OperatorNotificationPrompt compact />);
    fireEvent.click(screen.getByRole("button", { name: "Ocultar aviso de notificações" }));
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    view.unmount();
    render(<OperatorNotificationPrompt compact />);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("operator-notification-prompt.dismissed.v1")).toBe("1");
    expect(state.request).not.toHaveBeenCalled();
    expect(state.save).not.toHaveBeenCalled();
  });
});
