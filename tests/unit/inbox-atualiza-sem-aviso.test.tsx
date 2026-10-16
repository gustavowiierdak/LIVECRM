import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ onChange: null as null | ((p: unknown) => void) }));
vi.mock("@/hooks/auth/AuthProvider", () => ({ useActiveOrg: () => ({ orgId: "org-1" }) }));
vi.mock("@/hooks/realtime/useRealtimeChannel", () => ({
  useRealtimeChannel: ({ onChange }: { onChange: (p: unknown) => void }) => { fake.onChange = onChange; },
}));
vi.mock("@/lib/notifications/push_client", () => ({ syncPushSubscription: vi.fn() }));
vi.mock("@/hooks/notifications/OpenConversationContext", () => ({ getOpenConversationId: () => "conv-1" }));
vi.mock("@/lib/notifications/policy", () => ({ shouldNotifyInbound: () => false }));
import { useInboundMessageAlerts } from "@/hooks/notifications/useInboundMessageAlerts";

it("mensagem atualiza badges e atendimento web mesmo sem mostrar popup", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  let servidor = 0;
  const { result, unmount } = renderHook(() => {
    useInboundMessageAlerts();
    const contagem = useQuery({ queryKey: ["conversation-counts", "org-1"], queryFn: async () => servidor });
    const atendimento = useQuery({ queryKey: ["webchat-attendance", "user-1", "org-1", "conv-1", null], queryFn: async () => servidor });
    const outro = useQuery({ queryKey: ["webchat-attendance", "user-1", "org-1", "conv-2", null], queryFn: async () => servidor });
    return { contagem: contagem.data, atendimento: atendimento.data, outro: outro.data };
  }, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  await waitFor(() => expect(result.current).toEqual({ contagem: 0, atendimento: 0, outro: 0 }));
  servidor = 1;
  act(() => fake.onChange!({ new: { conversation_id: "conv-1", direction: "inbound" } }));
  await waitFor(() => expect(result.current).toEqual({ contagem: 1, atendimento: 1, outro: 0 }));
  unmount();
  client.clear();
});
