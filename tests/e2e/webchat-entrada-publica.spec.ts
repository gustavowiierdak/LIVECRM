/**
 * Prova pela tela do caminho que o cliente e o operador percorrem:
 * Conexões → link público → primeira mensagem → Inbox → resposta.
 * A organização é isolada e apagada ao fim; nenhuma sessão WhatsApp é usada.
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { expect, test } from "./helpers/test";
import { credenciaisSupabaseDeTeste } from "../../scripts/lib/env-de-teste";

const credenciais = credenciaisSupabaseDeTeste();
const db = createClient(credenciais.url, credenciais.serviceRole, {
  auth: { persistSession: false },
});
const sufixo = randomUUID().slice(0, 8);
const email = `webchat-publico-${sufixo}@invariant.test`;
const senha = `Local-${randomUUID()}!`;
const nomeCliente = `Cliente Web ${sufixo}`;
const primeiraMensagem = `Preciso de ajuda com a internet ${sufixo}`;
const respostaOperador = `Vamos ajudar voce ${sufixo}`;
const evidencia = "evidence/webchat-entrada-publica";

let orgId = "";
let usuarioId = "";

test.describe("atendimento web público até a Inbox", () => {
  test.describe.configure({ timeout: 240_000 });

  test.beforeAll(async () => {
    const { data: usuario, error: erroUsuario } = await db.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true,
    });
    if (erroUsuario || !usuario.user) throw erroUsuario ?? new Error("Usuário não criado");
    usuarioId = usuario.user.id;

    const { data: org, error: erroOrg } = await db
      .from("organizations")
      .insert({
        slug: `webchat-publico-${sufixo}`,
        legal_name: `Webchat Público ${sufixo}`,
        display_name: `Webchat Público ${sufixo}`,
        onboarded_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (erroOrg || !org) throw erroOrg ?? new Error("Organização não criada");
    orgId = (org as { id: string }).id;

    const { error: erroVinculo } = await db.from("user_organizations").insert({
      organization_id: orgId,
      user_id: usuarioId,
      role: "admin",
      accepted_at: new Date().toISOString(),
    });
    if (erroVinculo) throw erroVinculo;
  });

  test.afterAll(async () => {
    if (orgId) await db.from("organizations").delete().eq("id", orgId);
    if (usuarioId) await db.auth.admin.deleteUser(usuarioId);
  });

  test("cliente inicia e recebe resposta no mesmo canal", async ({ page, browser }) => {
    fs.mkdirSync(evidencia, { recursive: true });

    await page.goto("/login");
    await page.getByLabel(/e-?mail/i).fill(email);
    await page.getByLabel(/senha/i).fill(senha);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.waitForURL(/\/app(?:\/|$)/, { timeout: 60_000 });

    await page.goto("/app/connections?aba=web");
    await expect(page.getByRole("tab", { name: "Atendimento web" })).toBeVisible();
    await expect(page.getByText("Atendimento web separado")).toBeVisible();
    await page.getByLabel("Permitir atendimento web nesta empresa").check();
    await page.getByLabel("Suporte", { exact: true }).check();
    const origem = new URL(page.url()).origin;
    await page.getByLabel("Endereços permitidos").fill(origem);
    await page.getByRole("button", { name: "Salvar atendimento web" }).click();
    await expect(page.getByLabel("Link para clientes")).toHaveValue(
      /\/atendimento\/[0-9a-f-]{36}$/,
    );
    await page.screenshot({ path: `${evidencia}/01-conexoes.jpg`, fullPage: true });
    const link = await page.getByLabel("Link para clientes").inputValue();

    const contextoCliente = await browser.newContext({ colorScheme: "dark" });
    try {
      await contextoCliente.addInitScript(() => localStorage.setItem("deskcomm-theme", "dark"));
      const cliente = await contextoCliente.newPage();
      await cliente.goto(link);
      await expect(cliente.locator("html")).toHaveAttribute("data-theme", "dark");
      await expect(cliente.locator("main")).toHaveAttribute("data-theme", "light");
      await expect(cliente.locator("main")).toHaveCSS("background-color", "rgb(250, 249, 246)");
      await expect(
        cliente.getByRole("heading", { name: "Vamos iniciar seu atendimento" }),
      ).toBeVisible();
      await cliente.getByLabel("Seu nome").fill(nomeCliente);
      await cliente.getByLabel("Como podemos ajudar?").fill(primeiraMensagem);
      await cliente.screenshot({ path: `${evidencia}/02-pagina-cliente.jpg`, fullPage: true });
      await cliente.getByRole("button", { name: "Iniciar atendimento" }).click();
      await expect(cliente.getByText(primeiraMensagem)).toBeVisible({ timeout: 30_000 });

      await page.goto("/app/inbox?filter=all");
      await page.getByLabel("Buscar conversas", { exact: true }).fill(nomeCliente);
      const conversa = page
        .locator("button[data-conversation-id]")
        .filter({ hasText: nomeCliente });
      await expect(conversa).toBeVisible({ timeout: 60_000 });
      await conversa.click();
      const painel = page.getByRole("region", { name: "Atendimento web" });
      await expect(painel.getByText(primeiraMensagem)).toBeVisible({ timeout: 30_000 });
      await page.screenshot({ path: `${evidencia}/03-inbox.jpg`, fullPage: true });
      await painel
        .getByRole("textbox", { name: "Responder pelo atendimento web" })
        .fill(respostaOperador);
      await painel.getByRole("button", { name: "Enviar", exact: true }).click();
      await expect(painel.getByText(respostaOperador)).toBeVisible();
      await expect(cliente.getByText(respostaOperador)).toBeVisible({ timeout: 20_000 });
      await cliente.screenshot({ path: `${evidencia}/04-resposta-cliente.jpg`, fullPage: true });

      await page.getByRole("button", { name: "Fechar", exact: true }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Fechar", exact: true })
        .click();
      await expect(cliente.getByText("Atendimento encerrado pela equipe.")).toBeVisible({
        timeout: 20_000,
      });
      await expect(
        cliente.getByText("Atendimento encerrado", { exact: true }).first(),
      ).toBeVisible();
      await expect(cliente.getByRole("textbox", { name: "Mensagem" })).toHaveCount(0);
      await expect(cliente.getByRole("button", { name: "Novo atendimento" })).toBeEnabled();
      await expect(cliente.getByText(primeiraMensagem)).toBeVisible();
      await expect(cliente.getByText(respostaOperador)).toBeVisible();
      await cliente.screenshot({
        path: `${evidencia}/05-atendimento-encerrado.jpg`,
        fullPage: true,
      });

      await cliente.setViewportSize({ width: 390, height: 844 });
      await cliente.getByRole("button", { name: "Escolher assunto" }).click();
      await expect(cliente.getByRole("dialog")).toHaveAttribute("data-theme", "light");
      await expect(cliente.getByRole("dialog")).toHaveCSS("background-color", "rgb(250, 249, 246)");
      await expect(cliente.getByRole("dialog")).toHaveCSS("color", "rgb(28, 26, 22)");
    } finally {
      await contextoCliente.close();
    }
  });
});
