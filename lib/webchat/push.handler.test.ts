import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventRow } from "@/lib/event-log/dispatcher";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  setVapid: vi.fn(),
  createAdmin: vi.fn(),
}));
vi.mock("web-push", () => ({ default: { sendNotification: mocks.send, setVapidDetails: mocks.setVapid } }));
vi.mock("@/lib/notifications/vapid", () => ({
  vapidPronto: () => true,
  vapidPublica: () => "public-key",
  vapidSubject: async () => "mailto:test@example.com",
}));
vi.mock("@/lib/env", () => ({ env: { VAPID_PRIVATE_KEY: "private-key" } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdmin }));

import { webchatPushHandler } from "./push.handler";

function event(): EventRow {
  return {
    id: "event-1", organization_id: "org-a", event_type: "webchat.reply_created",
    entity_kind: "webchat_message", entity_id: "message-1", payload: {}, metadata: {},
    consumed_by: [], attempts: 0,
  };
}

function adminFalso(direction: string = "operator", expired = false) {
  const now = Date.now();
  const filters: Array<{ table: string; column: string; value: string }> = [];
  const rows: Record<string, unknown> = {
    webchat_messages: {
      id: "message-1", direction, visitor_session_id: "session-a",
      created_at: new Date(now - 30_000).toISOString(),
    },
    webchat_visitor_sessions: {
      id: "session-a", source_conversation_id: "conversation-a", revoked_at: null,
      expires_at: new Date(now + (expired ? -1 : 3_600_000)).toISOString(),
    },
    webchat_channel_configs: { public_id: "00000000-0000-4000-8000-000000000001", enabled: true },
    conversations: { status: "open" },
    webchat_push_subscriptions: [{
      id: "push-a", endpoint: "https://push.example/a", p256dh: "key", auth: "auth",
      created_at: new Date(now - 60_000).toISOString(),
    }],
  };
  const admin = {
    from(table: string) {
      const query = {
        select: () => query,
        eq: (column: string, value: string) => {
          filters.push({ table, column, value });
          return query;
        },
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
        then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
          resolve({ data: rows[table] ?? null, error: null }),
      };
      return query;
    },
  };
  return { admin, filters };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.send.mockResolvedValue(undefined);
});

describe("push do visitante", () => {
  it("envia aviso privado apenas para a sessao da resposta e abre o link publico", async () => {
    const { admin, filters } = adminFalso();
    mocks.createAdmin.mockReturnValue(admin);
    const result = await webchatPushHandler.handle(event());
    expect(result).toMatchObject({ status: "ok", detail: "sent:1" });
    expect(filters).toContainEqual({ table: "webchat_push_subscriptions", column: "organization_id", value: "org-a" });
    expect(filters).toContainEqual({ table: "webchat_push_subscriptions", column: "visitor_session_id", value: "session-a" });
    const payload = JSON.parse(mocks.send.mock.calls[0]?.[1] as string) as Record<string, string>;
    expect(payload.href).toBe("/atendimento/00000000-0000-4000-8000-000000000001");
    expect(payload.body).toBe("Toque para abrir a conversa.");
    expect(JSON.stringify(payload)).not.toContain("CPF");
  });

  it("nao avisa mensagem do proprio visitante", async () => {
    const { admin } = adminFalso("visitor");
    mocks.createAdmin.mockReturnValue(admin);
    expect(await webchatPushHandler.handle(event())).toMatchObject({ status: "skipped" });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("nao avisa depois de a sessao expirar", async () => {
    const { admin } = adminFalso("operator", true);
    mocks.createAdmin.mockReturnValue(admin);
    expect(await webchatPushHandler.handle(event())).toMatchObject({ status: "skipped", detail: "sessao_inativa" });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
