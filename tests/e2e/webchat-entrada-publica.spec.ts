/**
 * Prova pela tela do caminho que o cliente e o operador percorrem:
 * Conexões → link público → primeira mensagem → Inbox → resposta.
 * A organização é isolada e apagada ao fim; nenhuma sessão WhatsApp é usada.
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import AxeBuilder from "@axe-core/playwright";

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
const evidencia = "/tmp/livecrm-ui-web";

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
        settings: { branding: { accent_hex: "#710096", app_name: "CRM de teste" } },
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
    const errosDePagina: string[] = [];
    page.on("pageerror", (error) => errosDePagina.push(error.message));
    const falhasHttp: string[] = [];
    page.on("response", (response) => {
      if (response.status() >= 500) falhasHttp.push(`${response.status()} ${new URL(response.url()).pathname}`);
    });
    await page.setViewportSize({ width: 1440, height: 900 });

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
      const inicio = page.getByRole("region", { name: "Início do operador" });
      await expect(inicio.getByRole("heading", { name: "Visão geral" })).toBeVisible();
      await expect(inicio.getByRole("button", { name: "Abrir Fila" })).toContainText("1");
      await expect(page.getByRole("separator", { name: "Ajustar largura da ficha do contato" })).toHaveCount(0);
      await inicio.getByRole("button", { name: "Atalhos de teclado" }).click();
      await expect(page.getByRole("dialog", { name: "Atalhos de teclado" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect.soft(inicio.getByRole("button", { name: "Atalhos de teclado" })).toBeFocused();
      await inicio.getByRole("button", { name: "Buscar conversas" }).click();
      await expect(page.getByLabel("Buscar conversas", { exact: true })).toBeFocused();
      await page.getByLabel("Buscar conversas", { exact: true }).fill("cliente inexistente");
      await inicio.getByRole("button", { name: "Abrir Fechadas" }).click();
      await expect(page).toHaveURL(/filter=closed/);
      await expect(page.getByLabel("Buscar conversas", { exact: true })).toHaveValue("");
      await inicio.getByRole("button", { name: "Abrir Fila" }).click();
      await expect(page).toHaveURL(/filter=unassigned/);
      await expect(page.locator("button[data-conversation-id]").filter({ hasText: nomeCliente })).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      await page.screenshot({ path: `${evidencia}/13-inicio-operador-claro.png`, fullPage: true });
      await page.getByLabel("Buscar conversas", { exact: true }).fill(nomeCliente);
      const conversa = page
        .locator("button[data-conversation-id]")
        .filter({ hasText: nomeCliente });
      await expect(conversa).toBeVisible({ timeout: 60_000 });
      await conversa.click();
      const painel = page.getByRole("region", { name: "Atendimento web" });
      await expect(painel.getByText(primeiraMensagem)).toBeVisible({ timeout: 30_000 });
      const cabecalho = page.locator(".crm-conversation-header");
      const acoes = page.getByRole("group", { name: "Ações do atendimento" });
      await expect(page.locator(".crm-service-dock").getByRole("button", { name: "Fechar", exact: true })).toBeVisible();
      await expect(cabecalho.getByRole("heading", { name: nomeCliente })).toBeVisible();
      for (const name of ["Assumir", "Transferir", "Lembrar", "Fechar", "Arquivar"])
        await expect(acoes.getByRole("button", { name, exact: true })).toBeVisible();
      // Abrir e cancelar não pode encerrar nem arquivar a conversa.
      await acoes.getByRole("button", { name: "Arquivar", exact: true }).click();
      await expect(page.getByRole("alertdialog")).toContainText("Arquivar esta conversa?");
      await page.getByRole("alertdialog").getByRole("button", { name: "Cancelar" }).click();
      await expect(painel.getByRole("textbox", { name: "Responder pelo atendimento web" })).toBeEnabled();
      await page.screenshot({ path: `${evidencia}/03-inbox.jpg`, fullPage: true });
      await painel
        .getByRole("textbox", { name: "Responder pelo atendimento web" })
        .fill(respostaOperador);
      await painel.getByRole("button", { name: "Enviar", exact: true }).click();
      await expect(painel.getByText(respostaOperador)).toBeVisible();
      // Sender outside the bubble, real timestamp inside; web transport has no read receipt.
      await expect(painel.locator(".crm-message-sender").filter({ hasText: nomeCliente })).toBeVisible();
      const bolhaResposta = painel.getByTestId("webchat-message-bubble").filter({ hasText: respostaOperador });
      await expect(bolhaResposta.locator("time")).toHaveAttribute("datetime", /T/);
      await expect(bolhaResposta.locator("time")).toHaveText(/^\d{2}:\d{2}$/);
      await expect(bolhaResposta.locator(".crm-message-sender")).toHaveCount(0);
      await expect(painel.locator('[aria-label="Lida"]')).toHaveCount(0);
      await expect(cliente.getByText(respostaOperador)).toBeVisible({ timeout: 20_000 });
      await cliente.screenshot({ path: `${evidencia}/04-resposta-cliente.jpg`, fullPage: true });

      // The operator skin must not change routing, public chat or available actions.
      await expect(page.locator(".crm-queue-heading").getByText("Atendimentos", { exact: true })).toBeVisible();
      const filas = page.locator(".crm-queue-tabs");
      for (const nome of ["Fila", "Minhas", "Todas", "Fechadas", "Arquivadas", "Automático"])
        await expect(filas.getByRole("tab", { name: new RegExp(`^${nome}`) })).toBeInViewport();
      await filas.getByRole("tab", { name: /^Todas/ }).focus();
      await page.keyboard.press("ArrowDown");
      await expect(filas.getByRole("tab", { name: /^Fechadas/ })).toHaveAttribute("data-state", "active");
      await page.keyboard.press("ArrowUp");
      await expect(filas.getByRole("tab", { name: /^Todas/ })).toHaveAttribute("data-state", "active");
      await expect(page.getByRole("button", { name: "Expandir sidebar" })).toBeVisible();
      await expect(page.locator(".crm-contact-panel")).toBeVisible();
      const ficha = page.getByRole("complementary", { name: "Ficha do contato" });
      await expect(ficha.getByRole("group", { name: "Ações do contato" })).toBeVisible();
      await expect(ficha.getByRole("link", { name: "Ver contato" })).toHaveAttribute("href", /\/app\/contacts\//);
      await expect(ficha.getByRole("region", { name: "Dados do atendimento" })).toContainText("Atendimento web");
      await ficha.getByRole("button", { name: "Tags do contato" }).click();
      await expect(ficha.getByRole("textbox", { name: "Adicionar tag ao contato" })).toBeVisible();
      await ficha.getByRole("button", { name: "Tags do contato" }).click();
      await expect(ficha.getByRole("textbox", { name: "Adicionar tag ao contato" })).toHaveCount(0);
      await ficha.getByRole("button", { name: "Vincular cadastro do IXC" }).click();
      const vinculo = page.getByRole("dialog", { name: "Vincular cadastro do IXC" });
      await expect(vinculo.getByLabel("CPF/CNPJ do titular")).toBeVisible();
      await expect(vinculo.getByRole("button", { name: "Consultar e vincular" })).toBeDisabled();
      await vinculo.getByRole("button", { name: "Cancelar", exact: true }).click();
      const memoria = ficha.getByTestId("inbox-memoria").locator("summary");
      await memoria.focus();
      await page.keyboard.press("Enter");
      await expect(ficha.getByText("Nenhum fato durável registrado.")).toBeVisible();
      await memoria.press("Enter");
      await expect(ficha.getByText("Nenhum fato durável registrado.")).not.toBeVisible();
      await expect(ficha.getByTestId("inbox-demandas")).toBeVisible();
      await expect(page.locator(".crm-inbox")).toHaveCSS("background-color", "rgb(245, 246, 249)");
      await page.screenshot({ path: `${evidencia}/06-operador-claro.png`, fullPage: true });
      const acessibilidade = await new AxeBuilder({ page }).include(".crm-inbox").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      expect.soft(acessibilidade.violations).toEqual([]);

      // The composer skin must preserve note privacy and keyboard semantics.
      const notaPrivada = `Contexto interno ${sufixo}`;
      const editor = painel.getByRole("textbox", { name: "Responder pelo atendimento web" });
      await painel.getByRole("button", { name: "Nota interna", exact: true }).click();
      await expect(painel.getByRole("button", { name: "Nota interna", exact: true })).toHaveAttribute("aria-pressed", "true");
      await editor.fill(notaPrivada);
      await editor.press("Shift+Enter");
      await editor.pressSequentially("Somente para a equipe.");
      await expect(editor).toHaveValue(`${notaPrivada}\nSomente para a equipe.`);
      await expect(painel.getByRole("status")).toContainText("Esta nota fica visível apenas para a equipe.");
      await page.screenshot({ path: `${evidencia}/16-editor-nota.png`, fullPage: true });
      await editor.press("Enter");
      await expect(editor).toHaveValue("");
      await expect(painel.getByText(notaPrivada, { exact: false })).toBeVisible();
      await expect(cliente.getByText(notaPrivada, { exact: false })).toHaveCount(0);
      await painel.getByRole("button", { name: "Responder", exact: true }).click();
      await expect(painel.getByRole("button", { name: "Responder", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(painel.getByText("Esta nota fica visível apenas para a equipe.")).toHaveCount(0);

      await acoes.getByRole("button", { name: "Transferir", exact: true }).click();
      const transferencia = page.getByRole("dialog", { name: "Transferir conversa" });
      await expect(transferencia.getByText("Nenhum outro atendente disponível nesta organização.")).toBeVisible();
      await expect(transferencia.getByRole("button", { name: "Transferir", exact: true })).toBeDisabled();
      await transferencia.getByLabel("Motivo (opcional)").fill("Conferência visual local, sem transferência.");
      await page.screenshot({ path: `${evidencia}/17-transferencia.png`, fullPage: true });
      await page.keyboard.press("Escape");
      await expect(acoes.getByRole("button", { name: "Transferir", exact: true })).toBeFocused();

      await page.getByRole("button", { name: "Expandir sidebar" }).click();
      await expect(page.getByRole("button", { name: "Recolher sidebar" })).toBeVisible();
      await page.setViewportSize({ width: 1280, height: 800 });
      await expect(painel.getByRole("textbox", { name: "Responder pelo atendimento web" })).toBeInViewport();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      await page.getByRole("button", { name: "Recolher sidebar" }).click();
      await page.getByRole("button", { name: "Conta e preferências" }).click();
      for (let i = 0; i < 3 && await page.locator("html").getAttribute("data-theme") !== "dark"; i++)
        await page.getByRole("button", { name: /^Tema:/ }).click();
      await page.keyboard.press("Escape");
      await expect(page.locator(".crm-inbox")).toHaveCSS("background-color", "rgb(27, 29, 35)");
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(painel.getByRole("log")).toHaveCSS("background-color", "rgb(43, 47, 62)");
      await expect(painel.locator(".crm-chat-outgoing").first()).toHaveCSS("background-color", "rgb(69, 75, 96)");
      await expect(page.locator(".crm-contact-profile")).toBeVisible();
      await page.screenshot({ path: `${evidencia}/07-operador-escuro.png`, fullPage: true });
      expect.soft((await new AxeBuilder({ page }).include(".crm-inbox").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);

      await page.getByRole("button", { name: "Conversas", exact: true }).click();
      await expect(inicio).toBeVisible();
      await expect(page.getByRole("complementary", { name: "Ficha do contato" })).toHaveCount(0);
      await page.screenshot({ path: `${evidencia}/14-inicio-operador-escuro.png`, fullPage: true });
      await page.setViewportSize({ width: 768, height: 1024 });
      await expect(inicio.getByRole("button", { name: "Abrir Minhas" })).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(inicio).not.toBeVisible();
      await expect(conversa).toBeVisible();
      await page.screenshot({ path: `${evidencia}/15-inicio-celular.png`, fullPage: true });
      await page.setViewportSize({ width: 1440, height: 900 });
      await conversa.click();
      await expect(page.getByRole("separator", { name: "Ajustar largura da ficha do contato" })).toBeVisible();

      await page.setViewportSize({ width: 1920, height: 1080 });
      await expect.poll(() => page.locator(".crm-queue").evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(351);
      await expect.poll(() => page.locator(".crm-contact-panel").evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(347);
      await page.screenshot({ path: `${evidencia}/11-operador-monitor.png`, fullPage: true });

      await page.setViewportSize({ width: 768, height: 1024 });
      await expect(painel.getByRole("textbox", { name: "Responder pelo atendimento web" })).toBeInViewport();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      await page.screenshot({ path: `${evidencia}/10-operador-tablet.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(acoes.getByRole("button", { name: "Transferir", exact: true })).toBeInViewport();
      await expect(acoes.getByRole("button", { name: "Fechar", exact: true })).toBeInViewport();
      await acoes.getByRole("button", { name: "Fechar", exact: true }).click();
      await expect(page.getByRole("alertdialog")).toBeInViewport();
      await expect(page.getByRole("alertdialog").getByRole("button", { name: "Cancelar" })).toBeInViewport();
      await page.screenshot({ path: `${evidencia}/18-confirmacao-celular.png`, fullPage: true });
      await page.getByRole("alertdialog").getByRole("button", { name: "Cancelar" }).click();
      await expect(painel.getByRole("textbox", { name: "Responder pelo atendimento web" })).toBeInViewport();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      await page.screenshot({ path: `${evidencia}/08-operador-celular.png`, fullPage: true });
      // Small phones and enlarged desktop text must leave room to read and write.
      await page.setViewportSize({ width: 320, height: 568 });
      await page.screenshot({ path: `${evidencia}/19-celular-compacto.png`, fullPage: false });
      await expect(painel.getByRole("textbox", { name: "Responder pelo atendimento web" })).toBeInViewport();
      await expect.poll(() => painel.getByRole("log").evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(100);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      await page.screenshot({ path: `${evidencia}/19-celular-compacto.png`, fullPage: false });
      // Header actions remain usable, even when its compact region scrolls.
      await acoes.getByRole("button", { name: "Transferir", exact: true }).focus();
      await expect(acoes.getByRole("button", { name: "Transferir", exact: true })).toBeInViewport();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog", { name: "Transferir conversa" })).toBeInViewport();
      await page.keyboard.press("Escape");
      await expect(acoes.getByRole("button", { name: "Transferir", exact: true })).toBeFocused();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: "Ficha", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Ficha do contato" })).toBeVisible();
      await expect(page.getByRole("dialog", { name: "Ficha do contato" }).getByRole("link", { name: "Ver contato" })).toBeVisible();
      await expect(page.getByRole("dialog", { name: "Ficha do contato" }).getByTestId("inbox-demandas")).toContainText("Responder à nova mensagem do cliente");
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      await page.screenshot({ path: `${evidencia}/12-ficha-celular.png`, fullPage: true });
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Conversas", exact: true }).click();
      await expect(conversa).toBeVisible();
      await page.screenshot({ path: `${evidencia}/09-filas-celular.png`, fullPage: true });
      await conversa.click();
      await expect(painel.getByText(respostaOperador)).toBeVisible();
      await page.setViewportSize({ width: 1440, height: 900 });

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
      await expect(cliente.getByText(notaPrivada, { exact: false })).toHaveCount(0);
      await cliente.screenshot({
        path: `${evidencia}/05-atendimento-encerrado.jpg`,
        fullPage: true,
      });

      await cliente.setViewportSize({ width: 390, height: 844 });
      await cliente.getByRole("button", { name: "Escolher assunto" }).click();
      await expect(cliente.getByRole("dialog")).toHaveAttribute("data-theme", "light");
      await expect(cliente.getByRole("dialog")).toHaveCSS("background-color", "rgb(250, 249, 246)");
      await expect(cliente.getByRole("dialog")).toHaveCSS("color", "rgb(28, 26, 22)");
      expect(errosDePagina).toEqual([]);
      expect(falhasHttp).toEqual([]);
    } finally {
      await contextoCliente.close();
    }
  });
});
