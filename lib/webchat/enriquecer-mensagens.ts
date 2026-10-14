import type { createAdminClient } from "@/lib/supabase/admin";
import type { MensagemWebchat } from "./types";

/** RPCs públicos retornam apenas campos de exibição; o path privado nunca vai ao browser. */
export async function enriquecerMensagensWebchat(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  visitorSessionId: string,
  mensagens: MensagemWebchat[],
): Promise<MensagemWebchat[]> {
  if (mensagens.length === 0) return mensagens;
  const { data, error } = await admin.from("webchat_messages")
    .select("id,metadata")
    .eq("organization_id", organizationId)
    .eq("visitor_session_id", visitorSessionId)
    .in("id", mensagens.map((item) => item.id));
  if (error) throw error;
  const anexos = new Map((data ?? []).map((item) => {
    const media = (item.metadata as { webchat_media?: { kind?: unknown; mime?: unknown } } | null)?.webchat_media;
    return [item.id, media] as const;
  }));
  return mensagens.map((item) => {
    const media = anexos.get(item.id);
    if (!media || (media.kind !== "image" && media.kind !== "audio") || typeof media.mime !== "string") return item;
    return { ...item, type: media.kind, media_mime: media.mime };
  });
}
