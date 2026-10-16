import { describe, expect, it } from "vitest";
import { tabToFilter, parseFilterParam } from "@/components/inbox/InboxLayout";
import { visibleInboxTabs } from "@/components/inbox/InboxFilters";
import { listConversationsQuerySchema } from "@/lib/schemas";

describe("histórico unificado em Encerrados", () => {
  it("pede fechados e arquivados no filtro do servidor", () => {
    expect(tabToFilter("closed")).toEqual({ status: ["closed", "archived"] });
    const query = listConversationsQuerySchema.parse({
      status: (tabToFilter("closed").status as readonly string[]).join(","),
    });
    expect(query.status).toEqual(["closed", "archived"]);
  });

  it("links antigos de arquivadas chegam ao mesmo histórico", () => {
    expect(parseFilterParam("archived")).toBe("closed");
    expect(parseFilterParam("closed")).toBe("closed");
    expect(tabToFilter("archived")).toEqual(tabToFilter("closed"));
    expect(parseFilterParam("invalido")).toBe("unassigned");
  });

  it("mantém apenas uma entrada do histórico para todos os papéis", () => {
    for (const role of ["viewer", "agent", "manager", "admin"] as const) {
      const tabs = visibleInboxTabs(role, "all");
      expect(tabs.filter((tab) => tab === "closed")).toHaveLength(1);
      expect(tabs).not.toContain("archived");
    }
  });
});
