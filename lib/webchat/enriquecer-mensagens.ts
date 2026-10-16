import type { createAdminClient } from "@/lib/supabase/admin";
import type { MensagemWebchat } from "./types";
import { citacaoWebchatSchema } from "./citacao";

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
    const metadata = item.metadata as { webchat_media?: { kind?: unknown; mime?: unknown }; webchat_reply?: unknown } | null;
    return [item.id, metadata] as const;
  }));
  return mensagens.map((item) => {
    const metadata = anexos.get(item.id);
    const quote = citacaoWebchatSchema.safeParse(metadata?.webchat_reply);
    const enriched = quote.success ? { ...item, reply_to: quote.data } : item;
    const media = metadata?.webchat_media;
    if (!media || (media.kind !== "image" && media.kind !== "audio") || typeof media.mime !== "string") return enriched;
    return { ...enriched, type: media.kind, media_mime: media.mime };
  });
}
