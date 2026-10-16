import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ShortcutsHelpDialog } from "./ShortcutsHelpDialog";

function Harness() {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>Abrir ajuda</button>
    <input aria-label="Resposta" onKeyDown={(event) => {
      if (event.key === "?") setOpen(true);
    }} />
    <ShortcutsHelpDialog open={open} onOpenChange={setOpen} />
  </>;
}

describe("atalhos preservam o contexto do teclado", () => {
  it("devolve o foco ao botão de origem depois de Escape", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Abrir ajuda" });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "Atalhos de teclado" })).toBeVisible();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("devolve o foco ao elemento do atalho, sem assumir um trigger fixo", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const editor = screen.getByRole("textbox", { name: "Resposta" });
    await user.click(editor);
    await user.keyboard("?");
    await user.click(screen.getByRole("button", { name: "Fechar" }));
    await waitFor(() => expect(editor).toHaveFocus());
  });
});
