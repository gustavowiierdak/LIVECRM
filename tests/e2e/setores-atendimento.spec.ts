import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "./helpers/test";
import { credenciaisSupabaseDeTeste } from "../../scripts/lib/env-de-teste";

const creds = credenciaisSupabaseDeTeste();
const db = createClient(creds.url, creds.serviceRole, { auth: { persistSession: false } });
test.setTimeout(120_000);

test("gestão vincula atendente, encaminha à fila e filtra o setor", async ({ page }) => {
  const org = randomUUID(),
    channel = randomUUID(),
    contact = randomUUID(),
    conv = randomUUID();
  const email = `setores-${randomUUID()}@invariant.test`,
    password = `Local-${randomUUID()}!`;
  const created = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: "Atendente Setores Teste" },
  });
  if (created.error || !created.data.user) throw created.error;
  const user = created.data.user.id;
  async function insert(table: string, row: Record<string, unknown>) {
    const { error } = await db.from(table).insert(row);
    if (error) throw error;
  }
  try {
    await insert("organizations", {
      id: org,
      slug: `setores-${org}`,
      legal_name: "Setores Local",
      display_name: "Setores Local",
      onboarded_at: new Date().toISOString(),
      settings: { visibility_mode: "all", routing: { mode: "manual" } },
    });
    await insert("user_organizations", {
      organization_id: org,
      user_id: user,
      role: "admin",
      accepted_at: new Date().toISOString(),
    });
    await insert("channel_sessions", {
      id: channel,
      organization_id: org,
      waha_session_name: `setores-${channel}`,
      display_name: "Canal Teste",
      status: "STOPPED",
      webhook_secret_encrypted: "\\x00",
    });
    await insert("contacts", {
      id: contact,
      organization_id: org,
      display_name: "Cliente Teste LOS",
      phone_number: "+5562999990123",
    });
    await insert("conversations", {
      id: conv,
      organization_id: org,
      contact_id: contact,
      channel_session_id: channel,
      status: "open",
    });
    await page.goto("/login");
    await page.getByLabel(/e-?mail/i).fill(email);
    await page.getByLabel(/senha/i).fill(password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.waitForURL(/\/app(?:\/|$)/);
    await page.goto("/app/team?aba=setores");
    await page.getByRole("button", { name: "Criar setores de atendimento" }).click();
    const section = page.getByRole("region", { name: "Setores de atendimento" });
    for (const nome of ["Comercial", "Agendamento", "Suporte Técnico", "Cobrança", "SAC"])
      await expect(section.getByText(nome, { exact: true })).toBeVisible();
    const group = page.getByRole("group", { name: "Atendentes de Suporte Técnico" });
    await group.getByLabel("Atendente Setores Teste").check();
    await group.locator("../..").getByRole("button", { name: "Salvar vínculos" }).click();
    await expect(group.locator("../..").getByText("1 atendente(s) vinculado(s)")).toBeVisible();
    await page.screenshot({ path: "/tmp/livecrm-setores-equipe.png", fullPage: true });
    await page.goto(`/app/inbox?id=${conv}&filter=all`);
    await page.getByRole("button", { name: "Transferir", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Transferir conversa" });
    await dialog.getByRole("tab", { name: "Setor", exact: true }).click();
    await dialog.getByRole("combobox").click();
    await page.getByRole("option", { name: "Suporte Técnico", exact: true }).click();
    await dialog.getByRole("button", { name: "Encaminhar à fila" }).click();
    await expect(dialog).not.toBeVisible();
    await expect
      .poll(
        async () =>
          (
            await db
              .from("conversations")
              .select("status,bot_silenced_until")
              .eq("organization_id", org)
              .eq("id", conv)
              .single()
          ).data,
      )
      .toMatchObject({ status: "pending", bot_silenced_until: "infinity" });
    await page.getByRole("combobox", { name: "Filtrar por setor" }).click();
    await page.getByRole("option", { name: "Suporte Técnico", exact: true }).click();
    const setores = (await page.request.get("/api/v1/team/setores")).json();
    const suporte = (await setores).data.find(
      (s: { slug: string }) => s.slug === "suporte-tecnico",
    );
    const result = await page.request.get(
      `/api/v1/conversations?atendimento_setor_id=${suporte.id}`,
    );
    expect(result.status()).toBe(200);
    expect((await result.json()).data.map((c: { id: string }) => c.id)).toContain(conv);
    await page.screenshot({ path: "/tmp/livecrm-setores-fila.png", fullPage: true });
  } finally {
    // Só fixtures locais deste teste. Nenhuma mensagem é enviada a um provedor.
    await db.from("conversations").delete().eq("organization_id", org);
    await db.from("contacts").delete().eq("organization_id", org);
    await db.from("channel_sessions").delete().eq("organization_id", org);
    await db.from("organizations").delete().eq("id", org);
    await db.auth.admin.deleteUser(user);
  }
});
